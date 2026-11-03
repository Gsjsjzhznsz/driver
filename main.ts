huskylens2.I2CInit()
huskylens2.switchAlgorithm(huskylens2.Algorithm.AlgorithmPoseRecognition)
let strip = robotbit.rgb()
basic.forever(function () {
    huskylens2.getResultPoseRecognition()
    if (huskylens2.availablePoseRecognition()) {
        if (huskylens2.poseIdExists(1)) {
            basic.showIcon(IconNames.Happy)
            strip.showColor(neopixel.colors(NeoPixelColors.Green))
        }
        if (huskylens2.poseIdExists(2)) {
            basic.showIcon(IconNames.Sad)
            music.play(music.tonePlayable(262, music.beat(BeatFraction.Whole)), music.PlaybackMode.UntilDone)
            music.play(music.tonePlayable(262, music.beat(BeatFraction.Whole)), music.PlaybackMode.UntilDone)
            music.play(music.tonePlayable(262, music.beat(BeatFraction.Whole)), music.PlaybackMode.UntilDone)
            strip.showColor(neopixel.colors(NeoPixelColors.Red))
            basic.pause(1000)
            strip.clear()
            basic.pause(1000)
            strip.showColor(neopixel.colors(NeoPixelColors.Red))
            basic.pause(1000)
            strip.clear()
            robotbit.MotorRunDelay(robotbit.Motors.M1A, 255, 1)
        }
        if (huskylens2.poseIdExists(3)) {
            basic.showIcon(IconNames.Scissors)
            music.play(music.tonePlayable(262, music.beat(BeatFraction.Half)), music.PlaybackMode.UntilDone)
            music.play(music.tonePlayable(262, music.beat(BeatFraction.Half)), music.PlaybackMode.UntilDone)
            music.play(music.tonePlayable(262, music.beat(BeatFraction.Half)), music.PlaybackMode.UntilDone)
            strip.showColor(neopixel.colors(NeoPixelColors.Red))
        }
    } else {
        basic.showIcon(IconNames.No)
    }
})
