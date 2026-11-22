// screenfix.ts —— HUSKYLENS 2 屏幕文字命令（官方协议组包 + 32字节分块 + KNOCK握手 + 应答解析）
//
// 真机“屏幕无显示/显示0”排查结论（三层问题，逐层修复）：
//   1) 积木数值丢失（本次修复的根因）：生成器用 math_number_minmax shadow，
//      MakeCode 解析失败，把颜色/字号/坐标全部反编译成 0 —— 屏幕上画的是
//      “黑色 0 号字”，看起来就是“显示0”或完全看不见。
//      现已改用普通 math_number shadow（与 MakeCode 官方保存格式一致）。
//   2) 传输层：官方库 protocolWrite()（DFRobot_HuskylensV2，小内存板 MAX_PL_LEN=32）
//      把超过 32 字节的帧拆成 32 字节一块、块间停 5ms 分多次 I2C 事务发送；
//      MakeCode 扩展却整包一次写入，中文文字帧 39~44 字节全部超限被固件丢弃。
//      本文件按官方语义分块发送。
//   3) 数据布局随固件版本不同（本文件提供双协议，默认旧版）：
//      · 旧版固件（2026-10-29 协议 V0.4 发布前出厂，即扩展 v1.1.7 所配对的版本）：
//        Data = RFU(1)+字号(1)+x(2)+y(2)+RFU(4)+文字长度(1)@10+文字+结束符+RGBA(4)+RFU(4)，
//        Data 长度 = 20+n（颜色在文字之后）。
//      · 新版固件（官方《HuskyLens2_Protocol》V0.4，2026-10-29 起）：
//        Data = RFU(1)+字号(1)+x(2)+y(2)+RFU(4)+RGBA(4)@10+文字长度(1)@14+文字，
//        Data 长度 = 14+1+n（颜色在文字之前）。
//      出厂固件用哪个布局可用积木“屏幕固件协议”切换（默认旧版）。
//
// 屏幕参数（官方协议）：分辨率 640x480，坐标原点左上角，x:0~640、y:0~480；
//   字号仅支持 20/24/26/27/28/32/36/40/48（无效字号固件拒绝不画）；
//   颜色 0xRRGGBB，huskylens2.setRGB 的返回值可直接使用。
// 帧格式：0x55 0xAA | 命令 | 算法ID | 数据长度(1字节) | 数据 | 校验和(累加和&0xFF)。

//% color=#00B0A8 weight=95
namespace ScreenFix {
    const HL_ADDR = 0x50          // HUSKYLENS 2 的 I2C 地址
    const CMD_KNOCK = 0x00        // 官方协议：握手（告知主机是小内存板，允许分块收包）
    const CMD_DRAW_TEXT = 0x28    // 官方协议：绘制文字
    const CMD_CLEAR_TEXT = 0x29   // 官方协议：清除所有文字
    const CMD_RETURN_ARGS = 0x1A  // 官方协议：命令应答帧（retValue=0 表示成功）
    const MAX_CHUNK = 32          // 单次 I2C 事务上限（官方库 Result.h：小内存板 MAX_PL_LEN=32）
    const FONTS = [20, 24, 26, 27, 28, 32, 36, 40, 48]  // 固件支持的字号档位

    export enum ScreenProtocol {
        //% block="旧版固件（2026-10前出厂）"
        Legacy = 0,
        //% block="新版固件（官方协议V0.4）"
        Official = 1
    }

    let protocol = ScreenProtocol.Legacy
    let knocked = false           // KNOCK 握手只需一次

    // 接收累积缓冲：解析固件应答帧
    const acc = Buffer.create(96)
    let accLen = 0

    /**
     * 选择屏幕协议布局。出厂固件为 2026-10-29 官方协议 V0.4 发布前的旧版（默认），
     * 若已升级 HUSKYLENS 固件请改为 Official。
     */
    //% blockId="ScreenFix_setProtocol" block="屏幕固件协议 %v"
    //% weight=80
    export function setProtocolVersion(v: ScreenProtocol): void {
        protocol = v
    }

    //% blockId="ScreenFix_clearText" block="屏幕清空文字"
    //% weight=88
    export function clearText(): void {
        ensureKnock()
        const pkt = Buffer.create(6)  // Buffer 默认全 0：算法ID=0(任意)、数据长度=0、无数据
        pkt[0] = 0x55
        pkt[1] = 0xAA
        pkt[2] = CMD_CLEAR_TEXT
        pkt[5] = checksum(pkt, 5)
        sendChunked(pkt)
        readRetValue(120)
    }

    //% blockId="ScreenFix_drawText" block="屏幕画文字 颜色%color 字号%fontSize x%x y%y 文字%content"
    //% color.min=0 fontSize.min=20 fontSize.max=48
    //% x.min=0 x.max=640 y.min=0 y.max=480
    //% weight=91
    export function drawText(color: number, fontSize: number, x: number, y: number, content: string): void {
        ensureKnock()
        // 字号夹紧到固件支持的档位（无效字号固件直接拒绝不画）
        let size = FONTS[0]
        for (let fi = 0; fi < FONTS.length; fi++) {
            if (Math.abs(FONTS[fi] - fontSize) < Math.abs(size - fontSize)) {
                size = FONTS[fi]
            }
        }
        fontSize = size
        if (x < 0) { x = 0 }
        if (x > 640) { x = 640 }
        if (y < 0) { y = 0 }
        if (y > 480) { y = 480 }
        const txt = Buffer.fromUTF8(content)
        let tlen = txt.length
        if (tlen > 240) { tlen = 240 }  // 文字长度为 1 字节：不得超过 255
        let pkt: Buffer
        if (protocol == ScreenProtocol.Official) {
            // 新版布局（官方协议 V0.4）：颜色@Data[10..13]、长度@Data[14]、文字@Data[15..]
            const dataLen = 15 + tlen
            pkt = Buffer.create(5 + dataLen + 1)
            pkt[6] = fontSize      // Data[1]
            pkt[7] = x & 0xFF      // Data[2..3]
            pkt[8] = (x >> 8) & 0xFF
            pkt[9] = y & 0xFF      // Data[4..5]
            pkt[10] = (y >> 8) & 0xFF
            // Data[6..9] 保留 = 0
            pkt[15] = color & 0xFF        // Data[10..13] RGBA
            pkt[16] = (color >> 8) & 0xFF
            pkt[17] = (color >> 16) & 0xFF
            pkt[18] = (color >> 24) & 0xFF
            pkt[19] = tlen                // Data[14]
            for (let t = 0; t < tlen; t++) { pkt[20 + t] = txt[t] }  // Data[15..]
        } else {
            // 旧版布局（扩展 v1.1.7 配对固件）：长度@Data[10]、文字@Data[11..]、
            // 结束符、颜色@Data[12+n..15+n]、保留 4 字节，Data 长度 = 20+n
            const dataLen = 20 + tlen
            pkt = Buffer.create(5 + dataLen + 1)
            pkt[6] = fontSize      // Data[1]
            pkt[7] = x & 0xFF      // Data[2..3]
            pkt[8] = (x >> 8) & 0xFF
            pkt[9] = y & 0xFF      // Data[4..5]
            pkt[10] = (y >> 8) & 0xFF
            // Data[6..9] 保留 = 0
            pkt[15] = tlen                // Data[10] 文字字节长度（UTF-8）
            for (let t = 0; t < tlen; t++) { pkt[16 + t] = txt[t] }  // Data[11..]
            // Data[11+n] 结束符 = 0（Buffer 默认）
            pkt[17 + tlen] = color & 0xFF         // Data[12+n..15+n] RGBA
            pkt[18 + tlen] = (color >> 8) & 0xFF
            pkt[19 + tlen] = (color >> 16) & 0xFF
            pkt[20 + tlen] = (color >> 24) & 0xFF
            // Data[16+n..19+n] 保留 = 0
        }
        pkt[0] = 0x55        // 帧头
        pkt[1] = 0xAA
        pkt[2] = CMD_DRAW_TEXT
        pkt[3] = 0  // 算法 ID = AlgorithmAny（任意算法）
        pkt[4] = protocol == ScreenProtocol.Official ? 15 + tlen : 20 + tlen
        pkt[pkt.length - 1] = checksum(pkt, pkt.length - 1)
        sendChunked(pkt)
        readRetValue(150)
    }

    function checksum(buf: Buffer, len: number): number {
        let s = 0
        for (let i = 0; i < len; i++) {
            s = (s + buf[i]) & 0xFF
        }
        return s
    }

    // 首次使用屏幕命令前先握手：boardType=0（小内存板）+ 保留字节
    // 旧固件 Data=10 字节、新固件 Data=14 字节；握手失败不阻塞（尽力而为）
    function ensureKnock(): void {
        if (knocked) { return }
        knocked = true
        const dlen = protocol == ScreenProtocol.Official ? 14 : 10
        const pkt = Buffer.create(5 + dlen + 1)
        pkt[0] = 0x55
        pkt[1] = 0xAA
        pkt[2] = CMD_KNOCK
        pkt[3] = 0
        pkt[4] = dlen
        // Data 全 0：boardType=0 = 小内存板，其余保留
        pkt[pkt.length - 1] = checksum(pkt, pkt.length - 1)
        sendChunked(pkt)
        readRetValue(200)
    }

    // 分块发送（对齐官方库 protocolWrite 语义）：每块最多 32 字节、块间停 5ms
    function sendChunked(pkt: Buffer): void {
        let off = 0
        while (off < pkt.length) {
            const end = Math.min(off + MAX_CHUNK, pkt.length)
            pins.i2cWriteBuffer(HL_ADDR, pkt.slice(off, end))
            off = end
            if (off < pkt.length) {
                basic.pause(5)
            }
        }
    }

    function pushByte(b: number): void {
        if (accLen >= acc.length) { return }
        acc[accLen] = b
        accLen++
    }

    // 从累积缓冲解析 RETURN_ARGS(0x1A) 帧，成功返回 retValue（0=固件执行成功），
    // 解析失败/不完整返回 -1；已消费的帧从缓冲移除
    function parseReturnArgs(): number {
        let i = 0
        while (i + 5 <= accLen) {
            if (acc[i] == 0x55 && acc[i + 1] == 0xAA) {
                const dlen = acc[i + 4]
                const total = 5 + dlen + 1
                if (i + total > accLen) { break }  // 不完整，等下一次读取
                let s = 0
                for (let k = i; k < i + total - 1; k++) {
                    s = (s + acc[k]) & 0xFF
                }
                if (s == acc[i + total - 1]) {
                    const ret = acc[i + 2] == CMD_RETURN_ARGS ? acc[i + 7] : -1  // retValue 在 Data[1]
                    const remain = accLen - (i + total)
                    for (let k = 0; k < remain; k++) {
                        acc[k] = acc[i + total + k]
                    }
                    accLen = remain
                    return ret
                }
            }
            i++
        }
        if (i > 0) {
            const remain = accLen - i
            for (let k = 0; k < remain; k++) {
                acc[k] = acc[i + k]
            }
            accLen = remain
        }
        return -1
    }

    // 轮询读取固件应答（对齐扩展的 32 字节读取方式），返回 retValue 或 -1（超时）
    function readRetValue(maxMs: number): number {
        const start = input.runningTime()
        while (input.runningTime() - start < maxMs) {
            const chunk = pins.i2cReadBuffer(HL_ADDR, 32)
            for (let i = 0; i < chunk.length; i++) {
                pushByte(chunk[i])
            }
            const r = parseReturnArgs()
            if (r >= 0) {
                return r
            }
            basic.pause(10)
        }
        return -1
    }
}
