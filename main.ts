// ============================================================
// 司机打瞌睡识别报警系统（micro:bit + RobotBit + HUSKYLENS 2）
// 姿态 Id 约定：1 = 清醒　2 = 打瞌睡（重度报警）　3 = 疲劳征兆（预警）
// 结构：循环1轮询分发，循环2/3后台执行动作，互不阻塞
// ============================================================

// ---------- 可调参数（改数值即可，无需动逻辑） ----------
let 报警音调 = 262   // 报警长鸣音调（Hz）
let 报警次数 = 3     // 报警长鸣次数（每次约1秒）
let 闪灯次数 = 2     // 红灯闪烁组数（亮+灭为一组）
let 闪灯间隔 = 500   // 红灯亮/灭时长（毫秒）
let 电机速度 = 255   // M1A 电机速度（-255 ~ 255）
let 电机时长 = 1     // 电机运转秒数
let 预警音调 = 262   // 预警快滴音调（Hz）
let 预警次数 = 3     // 预警快滴次数（每次约0.5秒）
let 轮询间隔 = 50    // 姿态轮询间隔（毫秒），避免全速刷I2C

// ---------- 运行状态（无需修改） ----------
let 动作中 = false   // 报警/预警动作正在后台执行
let 报警请求 = false
let 预警请求 = false

// ---------- 硬件初始化 ----------
huskylens2.I2CInit()
huskylens2.switchAlgorithm(huskylens2.Algorithm.AlgorithmPoseRecognition)
let strip = robotbit.rgb()
robotbit.MotorStop(robotbit.Motors.M1A)  // 上电确保电机停止

// ---------- 循环 1：轮询姿态并分发任务（主循环） ----------
basic.forever(function () {
    huskylens2.getResultPoseRecognition()
    if (huskylens2.availablePoseRecognition()) {
        if (!(动作中)) {
            if (huskylens2.poseIdExists(1)) {
                // 清醒：绿灯
                basic.showIcon(IconNames.Happy)
                strip.showColor(neopixel.colors(NeoPixelColors.Green))
            } else if (huskylens2.poseIdExists(2)) {
                // 打瞌睡：请求重度报警（报警优先于预警）
                basic.showIcon(IconNames.Sad)
                动作中 = true
                报警请求 = true
            } else if (huskylens2.poseIdExists(3)) {
                // 疲劳征兆：红灯常亮 + 请求预警
                basic.showIcon(IconNames.Scissors)
                strip.showColor(neopixel.colors(NeoPixelColors.Red))
                动作中 = true
                预警请求 = true
            } else {
                basic.showIcon(IconNames.No)
            }
        }
    } else {
        if (!(动作中)) {
            basic.showIcon(IconNames.No)
        }
    }
    basic.pause(轮询间隔)
})

// ---------- 循环 2：后台执行重度报警（不阻塞轮询） ----------
basic.forever(function () {
    if (报警请求) {
        报警请求 = false
        for (let i = 0; i < 报警次数; i++) {
            music.play(music.tonePlayable(报警音调, music.beat(BeatFraction.Half)), music.PlaybackMode.UntilDone)
        }
        for (let j = 0; j < 闪灯次数; j++) {
            strip.showColor(neopixel.colors(NeoPixelColors.Red))
            basic.pause(闪灯间隔)
            strip.clear()
            basic.pause(闪灯间隔)
        }
        robotbit.MotorRunDelay(robotbit.Motors.M1A, 电机速度, 电机时长)
        动作中 = false
    }
    basic.pause(20)
})

// ---------- 循环 3：后台执行疲劳预警（不阻塞轮询） ----------
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
