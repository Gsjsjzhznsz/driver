// 司机打瞌睡识别报警系统（micro:bit + RobotBit + HUSKYLENS 2）
// 姿态 ID 约定：1=清醒　2=打瞌睡（重度报警）　3=疲劳征兆（预警）
// 四个 forever 循环并行工作：检测分发（含屏幕状态显示） / 重度报警 / 轻度预警 / 同步振动

// 可调参数区：只改数值即可调整系统行为，无需改动逻辑
let 报警音调 = 988   // 报警长鸣音调（Hz）
let 报警次数 = 3     // 报警长鸣次数（每次约1秒）
let 闪灯次数 = 2     // 红灯闪烁组数（亮+灭为一组）
let 闪灯间隔 = 500   // 红灯亮/灭时长（毫秒）
let 马达速度 = 255   // 方向盘振动马达速度（0~255，数值越大振动越强）
let 预警音调 = 900   // 预警快滴音调（Hz）
let 预警次数 = 3     // 预警快滴次数（每次约0.5秒）
let 轮询间隔 = 50    // 姿态轮询间隔（毫秒），避免全速刷I2C
let 丢失超时 = 5000  // 连续这么久检测不到司机，就停马达并清灯（毫秒）
let 疲劳升级毫秒 = 10000  // 疲劳征兆持续超过该时长，升级为重度报警（毫秒）

// 运行状态区：程序自动维护，无需修改
let 动作中 = false   // 有报警/预警动作正在后台执行
let 报警请求 = false
let 预警请求 = false
let 振动请求 = false
let 丢失停机 = false // 已因丢失姿态而停机
let 首次疲劳时间 = 0 // 疲劳征兆首次出现的时间，用于持续计时
let 最后检测时间 = 0
let 屏幕状态 = 0 // 摄像头屏幕当前状态：1=清醒 2=疲劳预警 3=打瞌睡报警 4=姿态未识别 5=监测中(开机) 6=未检测到司机

// 硬件初始化区：HUSKYLENS 用 I2C（P19/P20），灯与方向盘振动马达走 RobotBit
huskylens2.I2CInit()
huskylens2.switchAlgorithm(huskylens2.Algorithm.AlgorithmPoseRecognition)
let strip = robotbit.rgb()
robotbit.MotorStop(robotbit.Motors.M1A)  // 上电先确保振动马达停止
// 屏幕固件协议：默认旧版布局（2026-10-29 官方协议 V0.4 发布前出厂的 HUSKYLENS 2）。
// 若已升级 HUSKYLENS 固件，请把该积木下拉改为“新版固件（官方协议V0.4）”。
ScreenFix.setProtocolVersion(ScreenFix.ScreenProtocol.Legacy)
// 开机自检：短鸣一声、绿灯亮0.5秒，表示初始化完成
music.play(music.tonePlayable(预警音调, music.beat(BeatFraction.Quarter)), music.PlaybackMode.UntilDone)
strip.showColor(neopixel.colors(NeoPixelColors.Green))
basic.pause(500)
strip.clear()
// 屏幕：开机显示“监测中”（按官方协议直发屏幕命令），观众从摄像头屏幕即可看到系统已就绪
ScreenFix.clearText()
ScreenFix.drawText(huskylens2.setRGB(0, 255, 0), 48, 8, 4, "状态：监测中")
屏幕状态 = 5

// 循环1 主循环：按轮询间隔读取姿态，按ID亮灯/更新屏幕状态并派发任务
basic.forever(function () {
    huskylens2.getResultPoseRecognition()
    if (huskylens2.availablePoseRecognition()) {
        最后检测时间 = input.runningTime()
        丢失停机 = false
        if (!(动作中)) {
            if (huskylens2.poseIdExists(1)) {
                // 清醒：绿灯 + 笑脸
                basic.showIcon(IconNames.Happy)
                strip.showColor(neopixel.colors(NeoPixelColors.Green))
                首次疲劳时间 = 0  // 恢复清醒，清空疲劳计时
                // 屏幕：只在状态变化时刷新，不拖慢轮询
                if (屏幕状态 != 1) {
                    ScreenFix.clearText()
                    ScreenFix.drawText(huskylens2.setRGB(0, 255, 0), 48, 8, 4, "状态：清醒")
                    屏幕状态 = 1
                }
            } else if (huskylens2.poseIdExists(2)) {
                // 打瞌睡：请求重度报警，振动同时开始
                basic.showIcon(IconNames.Sad)
                首次疲劳时间 = 0
                动作中 = true
                报警请求 = true
                // 屏幕：红色报警大字，报警全程保持显示
                if (屏幕状态 != 3) {
                    ScreenFix.clearText()
                    ScreenFix.drawText(huskylens2.setRGB(255, 0, 0), 48, 8, 4, "状态：打瞌睡报警")
                    屏幕状态 = 3
                }
            } else if (huskylens2.poseIdExists(3)) {
                // 疲劳征兆：红灯
                basic.showIcon(IconNames.Scissors)
                strip.showColor(neopixel.colors(NeoPixelColors.Red))
                动作中 = true
                // 疲劳持续计时：首次出现时记录时间
                if (首次疲劳时间 == 0) {
                    首次疲劳时间 = input.runningTime()
                }
                // 持续超过阈值仍未恢复：升级为重度报警；否则仅预警
                if (input.runningTime() - 首次疲劳时间 > 疲劳升级毫秒) {
                    首次疲劳时间 = 0
                    报警请求 = true
                    // 屏幕：疲劳太久，升级为报警
                    if (屏幕状态 != 3) {
                        ScreenFix.clearText()
                        ScreenFix.drawText(huskylens2.setRGB(255, 0, 0), 48, 8, 4, "状态：打瞌睡报警")
                        屏幕状态 = 3
                    }
                } else {
                    预警请求 = true
                    // 屏幕：黄色预警提示观众
                    if (屏幕状态 != 2) {
                        ScreenFix.clearText()
                        ScreenFix.drawText(huskylens2.setRGB(255, 255, 0), 48, 8, 4, "状态：疲劳预警")
                        屏幕状态 = 2
                    }
                }
            } else {
                basic.showIcon(IconNames.No)
                首次疲劳时间 = 0
                // 屏幕：可见姿态不匹配已学习的ID
                if (屏幕状态 != 4) {
                    ScreenFix.clearText()
                    ScreenFix.drawText(huskylens2.setRGB(255, 255, 255), 48, 8, 4, "状态：姿态未识别")
                    屏幕状态 = 4
                }
            }
        }
    } else {
        if (!(动作中)) {
            basic.showIcon(IconNames.No)
            // 屏幕：看不到司机，立即提示观众
            if (屏幕状态 != 6) {
                ScreenFix.clearText()
                ScreenFix.drawText(huskylens2.setRGB(255, 255, 255), 48, 8, 4, "状态：未检测到司机")
                屏幕状态 = 6
            }
            // 行为保护：超过丢失超时仍看不到司机，停马达并清灯（只执行一次）
            if (input.runningTime() - 最后检测时间 > 丢失超时 && !(丢失停机)) {
                robotbit.MotorStop(robotbit.Motors.M1A)
                strip.clear()
                丢失停机 = true
            }
        }
    }
    basic.pause(轮询间隔)
})

// 循环2 重度报警：蜂鸣+红灯闪烁（次数见参数），结束时停止振动
basic.forever(function () {
    if (报警请求) {
        报警请求 = false
        振动请求 = true  // 通知循环4：与声光同时开始振动
        for (let i = 0; i < 报警次数; i++) {
            music.play(music.tonePlayable(报警音调, music.beat(BeatFraction.Half)), music.PlaybackMode.UntilDone)
        }
        for (let j = 0; j < 闪灯次数; j++) {
            strip.showColor(neopixel.colors(NeoPixelColors.Red))
            basic.pause(闪灯间隔)
            strip.clear()
            basic.pause(闪灯间隔)
        }
        robotbit.MotorStop(robotbit.Motors.M1A)  // 报警动作结束，停止振动
        动作中 = false
    }
    basic.pause(20)
})

// 循环3 轻度预警：快速短鸣几次，不打扰其他循环
basic.forever(function () {
    if (预警请求) {
        预警请求 = false
        for (let k = 0; k < 预警次数; k++) {
            music.play(music.tonePlayable(预警音调, music.beat(BeatFraction.Quarter)), music.PlaybackMode.UntilDone)
        }
        动作中 = false
    }
    basic.pause(20)
})

// 循环4 同步振动：与报警声光同时启动方向盘振动马达
basic.forever(function () {
    if (振动请求) {
        振动请求 = false
        if (!(丢失停机)) {
            // 已判定丢失姿态则不振动
            robotbit.MotorRun(robotbit.Motors.M1A, 马达速度)
        }
    }
    basic.pause(20)
})
