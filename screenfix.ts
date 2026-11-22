// screenfix.ts —— HUSKYLENS 2 屏幕文字命令（按官方协议组包 + 32字节分块发送）
// 真机“屏幕完全无显示”排查结论（两层问题叠加）：
//   1) 扩展自带 showText 的 0x28 数据布局与官方协议不符——官方协议
//      （DFRobot《HuskyLens2_Protocol.md》与 Arduino 库 ProtocolV2.cpp 的 drawText）
//      要求颜色在 Data 的 offset 10~13、文字长度在 offset 14、文字在 offset 15 起；
//      扩展却把文字写在颜色前面，固件按官方布局解析必然失败。
//   2) 更隐蔽的是 I2C 传输层：官方库 protocolWrite() 会把超过 32 字节的包拆成
//      32 字节一块、块间停 5ms 分多次 I2C 事务发送（小内存板配置 MAX_PL_LEN=32）。
//      固件的 I2C 接收按块处理，整包一次性写入超限时多余字节被丢弃、
//      校验失败整帧作废。中文状态文字的 0x28 包为 39~44 字节全部超限——
//      这就是“切算法/取结果正常（≤32字节）、屏幕完全无显示”的真正根因。
// 屏幕参数（官方协议）：分辨率 640x480，坐标原点左上角，x:0~640、y:0~480；
//   字号仅支持 20/24/26/27/28/32/36/40/48（填 0 等无效值固件直接拒绝不画）；
//   颜色 0xRRGGBB（官方 COLOR_GREEN=0x00FF00，huskylens2.setRGB 的返回值可直接用）。

//% color=#00B0A8 weight=95
namespace ScreenFix {
    const HL_ADDR = 0x50          // HUSKYLENS 2 的 I2C 地址
    const CMD_DRAW_TEXT = 0x28    // 官方协议：绘制文字
    const CMD_CLEAR_TEXT = 0x29   // 官方协议：清除所有文字
    const MAX_CHUNK = 32          // 单次 I2C 事务上限（官方库 Result.h：小内存板 MAX_PL_LEN=32）
    const FONTS = [20, 24, 26, 27, 28, 32, 36, 40, 48]  // 固件支持的字号档位

    //% blockId="ScreenFix_clearText" block="屏幕清空文字"
    //% weight=88
    export function clearText(): void {
        const pkt = Buffer.create(6)  // Buffer 默认全 0：算法ID=0(任意)、数据长度=0、无数据
        pkt[0] = 0x55
        pkt[1] = 0xAA
        pkt[2] = CMD_CLEAR_TEXT
        pkt[5] = checksum(pkt, 5)
        sendAndDrain(pkt)
    }

    //% blockId="ScreenFix_drawText" block="屏幕画文字 颜色%color 字号%fontSize x%x y%y 文字%content"
    //% color.min=0 fontSize.min=20 fontSize.max=48
    //% x.min=0 x.max=640 y.min=0 y.max=480
    //% weight=91
    export function drawText(color: number, fontSize: number, x: number, y: number, content: string): void {
        // 字号夹紧到固件支持的档位（手填 0 或其他无效值会被固件拒绝导致不显示）
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
        if (tlen > 240) { tlen = 240 }  // dataLen 为 1 字节：15+n 不得超过 255
        const dataLen = 15 + tlen       // 官方协议：14 字节头部字段 + 1 字节文字长度 + n 字节文字
        const pkt = Buffer.create(5 + dataLen + 1)
        pkt[0] = 0x55
        pkt[1] = 0xAA
        pkt[2] = CMD_DRAW_TEXT
        pkt[3] = 0             // ALGORITHM_ANY（任意算法）
        pkt[4] = dataLen       // 数据长度
        pkt[6] = fontSize      // Data[1] 字号
        pkt[7] = x & 0xFF      // Data[2] x 低位
        pkt[8] = (x >> 8) & 0xFF
        pkt[9] = y & 0xFF      // Data[4] y 低位
        pkt[10] = (y >> 8) & 0xFF
        // Data[6..9] 保留字段 = 0（Buffer 默认 0）
        pkt[15] = color & 0xFF          // Data[10] 颜色低位（官方布局：颜色在文字之前）
        pkt[16] = (color >> 8) & 0xFF
        pkt[17] = (color >> 16) & 0xFF
        pkt[18] = (color >> 24) & 0xFF
        pkt[19] = tlen                  // Data[14] 文字字节长度（UTF-8）
        for (let t = 0; t < tlen; t++) {
            pkt[20 + t] = txt[t]        // Data[15..] UTF-8 文字
        }
        pkt[pkt.length - 1] = checksum(pkt, pkt.length - 1)
        sendAndDrain(pkt)
    }

    function checksum(buf: Buffer, len: number): number {
        let s = 0
        for (let i = 0; i < len; i++) {
            s = (s + buf[i]) & 0xFF
        }
        return s
    }

    // 分块发送（对齐官方库 protocolWrite 的语义）：每块最多 32 字节、块间停 5ms；
    // 发完停 100ms 读走固件的 RETURN_ARGS 应答帧，保持应答通道干净
    function sendAndDrain(pkt: Buffer): void {
        let off = 0
        while (off < pkt.length) {
            const end = Math.min(off + MAX_CHUNK, pkt.length)
            pins.i2cWriteBuffer(HL_ADDR, pkt.slice(off, end))
            off = end
            if (off < pkt.length) {
                basic.pause(5)
            }
        }
        basic.pause(100)
        pins.i2cReadBuffer(HL_ADDR, 32)
    }
}
