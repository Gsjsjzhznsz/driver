// screenfix.ts —— HUSKYLENS 2 屏幕文字命令（按官方协议直发）
// 背景：huskylens2 扩展自带 showText 的 0x28 数据布局与官方协议不符——官方协议
// （DFRobot《HuskyLens2_Protocol.md》）要求 RGBA 颜色在 Data 的 offset 10~13、
// 文字长度在 offset 14、文字在 offset 15 起；扩展却把文字写在颜色前面，
// 固件按官方布局解析必然失败，屏幕完全无显示。本文件按官方协议自行组包。
// 屏幕坐标系：640x480；官方字号支持 20/24/26/27/28/32/36/40/48。

//% color=#00B0A8 weight=95
namespace ScreenFix {
    const HL_ADDR = 0x50         // HUSKYLENS 2 的 I2C 地址
    const CMD_DRAW_TEXT = 0x28   // 官方协议：绘制文字
    const CMD_CLEAR_TEXT = 0x29  // 官方协议：清除所有文字

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
        const txt = Buffer.fromUTF8(content)
        const dataLen = 15 + txt.length  // 官方协议：14 字节头部字段 + 1 字节文字长度 + n 字节文字
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
        pkt[15] = color & 0xFF          // Data[10] RGBA（官方位置：在文字之前）
        pkt[16] = (color >> 8) & 0xFF
        pkt[17] = (color >> 16) & 0xFF
        pkt[18] = (color >> 24) & 0xFF
        pkt[19] = txt.length            // Data[14] 文字长度
        for (let t = 0; t < txt.length; t++) {
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

    // 官方协议：每条命令固件都会回一帧 RETURN_ARGS 应答；发送后读取丢弃，保持应答通道干净
    function sendAndDrain(pkt: Buffer): void {
        pins.i2cWriteBuffer(HL_ADDR, pkt)
        basic.pause(100)
        pins.i2cReadBuffer(HL_ADDR, 32)
    }
}
