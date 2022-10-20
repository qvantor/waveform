# Wave table editor

## Modules

### Audio Processor

#### Data

* Audio Context
* Oscillator
* Analyser
* Frequency
* isPlay

#### Methods

* setFrequency(fq:number)
* setWave(realArray:number[], imagArray:number[])
* playToggle() - toggle play

### Wave table

#### Data

* **RateRange** - min/max amount of wave points
* **Wave-tables** - array of waves (up to 128)
* **Selected wave-table** - index in Wave-tables array

#### Methods

* setSelected(index:number)
* updateWave(index:number, wave:number[])
* addWave(wave: number[])

### Wave editor

#### Data

* Rate - amount of wave points in editor
* Wave - wave in editor

#### Methods

* setRate(rate:number)
* updateWave(index:number, value:number)

### Wave processor

#### Data

* RateRange - min/max amount of output wave points
* Rate - amount of output wave points
* Wave - output wave

#### Methods

* setWave(wave: number[])
* setRate(rate: number)


