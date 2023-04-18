const { on } = require("events");
const { stat } = require("fs");
const tjs = require("teslajs");
const util = require ("util");

module.exports = function createTesla({ Service, Characteristic }) {
  const CurrentTemperature = Characteristic.CurrentTemperature
  const LockCurrentState = Characteristic.LockCurrentState
  const LockTargetState = Characteristic.LockTargetState
  const SwitchOn = Characteristic.On

  return class Tesla {
    constructor(log, config) {
      this.conditioningTimer = null
      this.log = log
      this.name = config.name
      this.ref = config.token
      this.token = undefined
      this.vin = config.vin
      this.temperature = 0
      this.tempSetting = 0
      this.climateState = Characteristic.TargetHeatingCoolingState.OFF
      this.charging = false
      this.chargingState = Characteristic.ChargingState.NOT_CHARGEABLE
      this.batteryLevel = 0
      this.lastWakeupTS = 0
      this.lastVehicleId = 0
      this.lastVehicleIdTS = 0
      this.vehicleData = null
      this.getPromise = null
      this.isAsleep = null
      this.tokenTS = 0
      this.lastStateFetchTime = 0

      this.temperatureService = new Service.Thermostat(this.name + ' Thermostat', 'thermostat')
      this.temperatureService.getCharacteristic(Characteristic.CurrentTemperature)
        .on('get', this.getClimateState.bind(this, 'temperature'))
      this.temperatureService.getCharacteristic(Characteristic.TargetTemperature)
        .on('get', this.getClimateState.bind(this, 'setting'))
        .on('set', this.setTargetTemperature.bind(this))
      
        this.temperatureService.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
        .on('get', this.getClimateState.bind(this, 'state'))

      this.temperatureService.getCharacteristic(Characteristic.TargetHeatingCoolingState)
        .on('get', this.getClimateState.bind(this, 'state'))
        .on('set', this.setClimateOn.bind(this))
      this.temperatureService.getCharacteristic(Characteristic.TemperatureDisplayUnits)
        .on('get', (callback) => {
          this.log('Getting temperature display units...')
          callback(null, Characteristic.TemperatureDisplayUnits.FAHRENHEIT)
        })

      this.ConditioningService = new Service.Switch(this.name + ' Conditioning', 'conditioning')
      this.ConditioningService.getCharacteristic(Characteristic.On)
        .on('get', this.getConditioningState.bind(this))
        .on('set', this.setConditioningState.bind(this))
        
      this.lockService = new Service.LockMechanism(this.name + ' Doorlocks', 'doorlocks')
      this.lockService.getCharacteristic(LockCurrentState)
        .on('get', this.getLockState.bind(this))

      this.lockService.getCharacteristic(LockTargetState)
        .on('get', this.getLockState.bind(this))
        .on('set', this.setLockState.bind(this))

      this.chargeDoorService = new Service.LockMechanism(this.name + ' Charging Port', 'chargedoor')
      this.chargeDoorService.getCharacteristic(LockCurrentState)
        .on('get', this.getChargeDoorState.bind(this))

      this.chargeDoorService.getCharacteristic(LockTargetState)
        .on('get', this.getChargeDoorState.bind(this))
        .on('set', this.setChargeDoorState.bind(this))

      this.trunkService = new Service.LockMechanism(this.name + ' Trunk', 'trunk')
      this.trunkService.getCharacteristic(LockCurrentState)
        .on('get', this.getTrunkState.bind(this, 'trunk'))

      this.trunkService.getCharacteristic(LockTargetState)
        .on('get', this.getTrunkState.bind(this, 'trunk'))
        .on('set', this.setTrunkState.bind(this, 'trunk'))

      this.frunkService = new Service.LockMechanism(this.name + ' Front Trunk', 'frunk')
      this.frunkService.getCharacteristic(LockCurrentState)
        .on('get', this.getTrunkState.bind(this, 'frunk'))

      this.frunkService.getCharacteristic(LockTargetState)
        .on('get', this.getTrunkState.bind(this, 'frunk'))
        .on('set', this.setTrunkState.bind(this, 'frunk'))

      this.batteryLevelService = new Service.Lightbulb(this.name + ' Battery', 'battery')
      this.batteryLevelService.getCharacteristic(Characteristic.Brightness)
        .on('get', this.getBatteryLevel.bind(this))

      this.chargingService = new Service.Switch(this.name + ' Charging', 'charging')
      this.chargingService.getCharacteristic(Characteristic.On)
        .on('get', this.getChargingState.bind(this, 'charging'))
        .on('set', this.setCharging.bind(this))
      
      this.HornService = new Service.Switch(this.name + ' Horn', 'horn')
      this.HornService.getCharacteristic(Characteristic.On)
        .on('get', this.getHornState.bind(this))
        .on('set', this.setHornState.bind(this))

      this.LightsService = new Service.Switch(this.name + ' Lights', 'lights')
      this.LightsService.getCharacteristic(Characteristic.On)
        .on('get', this.getLightsState.bind(this))
        .on('set', this.setLightsState.bind(this))

      this.Connection = new Service.Switch(this.name + ' Connection', 'connection')
      this.Connection.getCharacteristic(Characteristic.On)
        .on('get', this.getConnection.bind(this))
        .on('set', this.setConnection.bind(this))

      this.Venting = new Service.Switch(this.name + ' Vent', 'vent')
      this.Venting.getCharacteristic(Characteristic.On)
        .on('get', this.getVentState.bind(this))
        .on('set', this.setVentState.bind(this))

      this.Defrost = new Service.Switch(this.name + ' Defrost', 'defrost')
      this.Defrost.getCharacteristic(Characteristic.On)
        .on('get', this.getDefrostState.bind(this))
        .on('set', this.setDefrostState.bind(this))

      this.SentryModeSwitch = new Service.Switch(this.name + ' Sentry Mode', 'sentry_mode');
      this.SentryModeSwitch.getCharacteristic(Characteristic.On)
        .on('get', this.getSentryMode.bind(this))
        .on('set', this.setSentryMode.bind(this));

    }

    async getSentryMode(callback) {
      const st = await this.getState();
      if (st === "online") {
        await this.getCarData();
        return callback(null, !!this.vehicleData.vehicle_state.sentry_mode);
      } else {
        return callback(null, false);
      }
    }
    
    async setSentryMode(state, callback) {
      const st = await this.getState();
      const onoff = state ? "true" : "false";
      if (st === "online") {
        try {
          const options = {
            authToken: this.token,
            vehicleID: await this.getVehicleId(),
          };
          const res = await tjs.setSentryModeAsync(options, onoff);
          if (res.result && !res.reason) {
            callback(null); // success
          } else {
            this.log("Error setting sentry mode: " + res.reason);
            callback(new Error("Error setting sentry mode. " + res.reason));
          }
        } catch (err) {
          this.log("Error setting sentry mode: " + util.inspect(arguments));
        }
      } else {
        callback(null, false);
      }
    }
    
    
    async getDefrostState(callback) {
      const st = await this.getState();
      if (st === "online") {
        await this.getCarData();
        return callback(null, !!this.vehicleData.climate_state.is_auto_conditioning_on);
      } else {
        return callback(null, false);
      }
    }
    

    async setDefrostState(state, callback) {
      const st = await this.getState();
      const onoff = state ? "true" : "false";
        try {
          const options = {
            authToken: this.token,
            vehicleID: await this.getVehicleId(),
          };
          const res = await tjs.maxDefrostAsync(options, onoff, callback);
          if (res.result && !res.reason) {
            callback(null); // success
          } else {
            this.log("Error setting defrost state: " + res.reason);
            callback(new Error("Error setting defrost state. " + res.reason));
          }
        } catch (err) {
          this.log("Error setting defrost state: " + util.inspect(arguments));
        }
    }
    
    
    async getVentState(callback) {
      const st = await this.getState();
      if (st === "online") {
        await this.getCarData();
        return callback(null, !!this.vehicleData.vehicle_state.fd_window);
      } else {
        return callback(null, false);
      }
    }

    async setVentState(state, callback) {
      const lat = 0;
      const lon = 0;
      const command = state ? "vent" : "close";
      const st = await this.getState();
        try {
          const options = {
            authToken: this.token,
            vehicleID: await this.getVehicleId(),
          };
          const res = await tjs.windowControlAsync(options, command, lat, lon, callback);
          if (res.result && !res.reason) {
            callback(null); // success
          } else {
            this.log("Error setting vent state: " + res.reason);
            callback(new Error("Error setting vent state. " + res.reason));
          }
        } catch (err) {
          this.log("Error setting vent state: " + util.inspect(arguments));
        }
    }
    

    async getConditioningState(callback) {
      const st = await this.getState();
      if (st === "asleep"){
        return callback(null, false)
      }
      else {
        return callback(null, !!this.conditioningTimer);
      }
      
    }
    
    async setConditioningState(on, callback) {
      this.log('Setting conditioning to on = ' + on)
      try {
        const options = {
          authToken: this.token,
          vehicleID: await this.getVehicleId(),
        };

        const res = on ? await tjs.climateStartAsync(options) : await tjs.climateStopAsync(options);
        if (res.result && !res.reason) {
          if (on) {
            this.conditioningTimer = setTimeout(async () => {
              setTimeout(function() {
                this.ConditioningService.getCharacteristic(Characteristic.On).updateValue(false);
              }.bind(this), 300);
              const driveStateRes = await tjs.driveStateAsync(options);
              const shiftState = driveStateRes.shift_state || "Parked";
              if (shiftState === "Parked") {
                const climateStopRes = await tjs.climateStopAsync(options);
              }
              this.conditioningTimer = null;
            }, 10 * 60 * 1000);
          } else {
            clearTimeout(this.conditioningTimer);
            this.conditioningTimer = null;
          }
          callback(null) // success
        } else {
          this.log("Error setting climate state: " + res.reason)
          callback(new Error("Error setting climate state. " + res.reason))
        }
      } catch (err) {
        this.log("Error setting charging state: " + util.inspect(arguments))
      }
    }

    getHornState(callback) {
      return callback(null, false);
    }

    async setHornState(state, callback) {
      try {
        const options = {
          authToken: this.token,
          vehicleID: await this.getVehicleId(),
        };
        const res = await tjs.honkHornAsync(options);
        if (res.result && !res.reason) {
          // Success
          this.log("Horn honked");
          this.HornService.getCharacteristic(Characteristic.On).updateValue(false);
          callback(null);
        } else {
          // Error
          const errorMessage = `Error honking horn: ${res.reason || "unknown error"}`;
          this.log(errorMessage);
          callback(new Error(errorMessage));
        }
      } catch (err) {
        // Exception
        const errorMessage = `Error honking horn: ${err.message}`;
        this.log(errorMessage);
        callback(new Error(errorMessage));
      }
    }
    

     getLightsState(callback) {
      return callback(null, false);
    }

    async setLightsState(callback) {
      try {
        const options = {
          authToken: this.token,
          vehicleID: await this.getVehicleId(),
        };
        const res = await tjs.flashLightsAsync(options);
        if (res.result && !res.reason) {
          callback(null) // success
          setTimeout(function() {
            this.LightsService.getCharacteristic(Characteristic.On).updateValue(false);
          }.bind(this), 1000);
        } else {
          this.log("Error setting lights state: " + res.reason)
          callback(new Error("Error setting lights state. " + res.reason))
        }
      } catch (err) {
        this.log("Error setting lights state: " + util.inspect(arguments))
      }
    }



    async getTrunkState(which, callback) {
      // this.log("Getting current trunk state...")
      try {
        const st = await this.getState();
        if (st === "online") {
          await this.getCarDataPromise()
          const vehicleState = this.vehicleData.vehicle_state;
          const res = which === 'frunk' ? !vehicleState.ft : !vehicleState.rt;
          this.log(`${which} state is ${res}`);
          return callback(null, res)
        }
        else {
          return callback(null, true)
        }
        
      } catch (err) {
        callback(err)
      }
    }

    async setTrunkState(which, state, callback) {
      var toLock = (state == LockTargetState.SECURED);
      this.log(`Setting ${which} to toLock = ${toLock}`);
      if (toLock) {
        this.log("cannot close trunks");
        callback(new Error("I can only open trunks"));
      }
      try {
        const options = {
          authToken: this.token,
          vehicleID: await this.getVehicleId(),
        };
        const driveStateRes = await tjs.driveStateAsync(options);

        const res = await tjs.openTrunkAsync(options,  which === 'trunk' ? tjs.TRUNK : tjs.FRUNK, callback);
        if (res.result && !res.reason) {
          const currentState = (state == LockTargetState.SECURED) ?
          LockCurrentState.SECURED : LockCurrentState.UNSECURED
          this.trunkService.setCharacteristic(LockCurrentState, currentState)
          callback(null) // success
        } else {
          this.log("Error setting trunk state: " + res.reason)
          callback(new Error("Error setting trunk state. " + res.reason))
        }
      } catch (err) {
        this.log("Error setting trunk state: " + util.inspect(arguments))
      }
    }
    
    async getBatteryLevel(callback) {
      // this.log("Getting current battery level...")
      try {
        await this.getCarDataPromise()
        const chargingState = this.vehicleData.charge_state;
        if (chargingState && chargingState.hasOwnProperty('battery_level')) {
          this.batteryLevel = chargingState.battery_level
        } else {
          this.log('Error getting battery level: ' + util.inspect(arguments))
          return callback(new Error('Error getting battery level.'))
        }
        this.log(`battery level is ${this.batteryLevel}`);
        return callback(null, this.batteryLevel)  
      } catch (err) {
        callback(err)
      }
    }

    async getChargingState(what, callback) {
      // this.log("Getting current charge state...")
      try {
        await this.getCarDataPromise()
        const chargingState = this.vehicleData.charge_state;
        if (chargingState) {
          this.charging = ((chargingState.charge_rate > 0) ? true : false)
          const connected = chargingState.charge_port_latch === 'Engaged' ? true : false
          this.chargingState = Characteristic.ChargingState.NOT_CHARGEABLE
          if (connected) {
            this.chargingState = Characteristic.ChargingState.NOT_CHARGING
          }
          if (this.charging) {
            this.chargingState = Characteristic.ChargingState.CHARGING
          }
        } else {
          this.log('Error getting charging state: ' + util.inspect(arguments))
          return callback(new Error('Error getting charging state.'))
        }
        this.log(`charging: ${what} is ${what === 'state' ? this.chargingState : this.charging}`);
        switch (what) {
          case 'state': return callback(null, this.chargingState)
          case 'charging': return callback(null, this.charging)
        }
      } catch (err) {
      }
    }

    async setCharging(on, callback) {
      this.log('Setting charging to on = ' + on)
      try {
        const options = {
          authToken: this.token,
          vehicleID: await this.getVehicleId(),
        };
        const res = on ? await tjs.startChargeAsync(options) : await tjs.stopChargeAsync(options);
        if (res.result && !res.reason) {
          callback(null) // success
        } else {
          if (res.reason !== 'complete' && res.reason !== 'not_charging') {
            this.log("Error setting charging state: " + res.reason)
            callback(new Error("Error setting charging state. " + res.reason))
          } else {
            callback(null) // success
            setTimeout(function() {
              this.chargingService.setCharacteristic(Characteristic.On, false);
            }.bind(this), 300)
          }
        }
      } catch (err) {
        this.log("Error setting charging state: " + util.inspect(arguments))
      }
    }

    celsiusToFer(cel) {
      return Math.round(cel * 1.8 + 32);
    }

    async setTargetTemperature(value, callback) {
      this.log(`Setting temp to ${value} (${this.celsiusToFer(value)}F)`);
      try {
        const options = {
          authToken: this.token,
          vehicleID: await this.getVehicleId(),
        };
        const res = await tjs.setTempsAsync(options, value, value)
        if (res.result && !res.reason) {
          callback(null) // success
        } else {
          this.log("Error setting temp: " + res.reason)
          callback(new Error("Error setting temp. " + res.reason))
        }
      } catch (err) {
        this.log("Error setting temp: " + util.inspect(arguments))
      }
    }

    async getClimateState(what, callback) {
      // this.log("Getting current climate state...")
      const st = await this.getState();
      if (st === "online") {
      try {
        await this.getCarDataPromise()
        const climateState = this.vehicleData.climate_state;
        let ret;
        switch (what) {
          case 'temperature':
            ret = climateState.inside_temp;
            break;
          case 'setting':
            ret = climateState.driver_temp_setting;
            break;
          case 'state':
            ret = climateState.is_auto_conditioning_on ? Characteristic.TargetHeatingCoolingState.AUTO : Characteristic.TargetHeatingCoolingState.OFF;
            break;
        }
        this.log(`climate: ${what} state is ${ret}`);
        return callback(null, ret);
      } 
      catch (err) {
      }
    }
    }

    async setClimateOn(state, callback) {
      const turnOn = state !== Characteristic.TargetHeatingCoolingState.OFF;
      this.log("Setting climate to = " + turnOn)
      try {
        const options = {
          authToken: this.token,
          vehicleID: await this.getVehicleId(),
        };
        const res = turnOn ? await tjs.climateStartAsync(options) : await tjs.climateStopAsync(options);
        if (res.result && !res.reason) {
          callback(null) // success
        } else {
          this.log("Error setting climate state: " + res.reason)
          callback(new Error("Error setting climate state. " + res.reason))
        }
      } catch (err) {
        this.log("Error setting climate state: " + util.inspect(arguments))
      }
    }
    
    async getLockState(callback) {
        const state = await this.getState();
        if (state === "online") {
          await this.getCarDataPromise();
          return callback(null, !!this.vehicleData.vehicle_state.locked);
        } else {
          return callback(null, true);
        }
      }
    
    async setLockState(state, callback) {
      const locked = state === LockTargetState.SECURED;
      this.log(`Setting car to locked = ${locked}`);
      try {
        const state = await this.getState();
        if (state !== "online") {
          this.log("Tesla is not online");
          return callback(null, false);
        }
        await this.getCarDataPromise();
        const options = {
          authToken: this.token,
          vehicleID: await this.getVehicleId(),
        };
        const res = locked ? await tjs.doorLockAsync(options) : await tjs.doorUnlockAsync(options);
        if (res.result && !res.reason) {
          const currentState = locked ? LockCurrentState.SECURED : LockCurrentState.UNSECURED;
          this.lockService.setCharacteristic(LockCurrentState, currentState);
          callback(null); // success
        } else {
          this.log(`Error setting lock state: ${res.reason}`);
          callback(new Error(`Error setting lock state. ${res.reason}`));
        }
      } catch (err) {
        this.log(`Error setting lock state: ${err}`);
      }
    }

    async getChargeDoorState(callback) {
      const st = await this.getState();
      if (st === "online") {
        try {
          await this.getCarDataPromise();
          return callback(null, !this.vehicleData.charge_state.charge_port_door_open);
        } catch (err) {
          return callback(err);
        }
      } else {
        return callback(null, true);
      }
    }

    async setChargeDoorState(state, callback) {
      const isLocked = state === LockTargetState.SECURED;
      this.log(`Setting charge door to locked = ${isLocked}`);
      
      try {
        const options = {
          authToken: this.token,
          vehicleID: await this.getVehicleId(),
        };
        
        const res = isLocked ? await tjs.closeChargePortAsync(options) : await tjs.openChargePortAsync(options);
        if (res.result && !res.reason) {
          const currentState = isLocked ? LockCurrentState.SECURED : LockCurrentState.UNSECURED;
          setTimeout(() => {
            this.chargeDoorService.setCharacteristic(LockCurrentState, currentState);
          }, 1);
          callback(null); // success
        } else {
          this.log(`Error setting charge door state: ${res.reason}`);
          callback(new Error(`Error setting charge door state. ${res.reason}`));
        }
      } catch (err) {
        this.log(`Error setting charge door state: ${util.inspect(arguments)}`);
        callback(new Error("Error setting charge door state."));
      }
    }
      

    async getCarDataPromise() {
      this.getPromise = this.getPromise || this.getCarData();
      return this.getPromise;
    }

    async getCarData() {
      return new Promise(async (resolve, reject) => {
          try {
            this.isRunning = true;
            const options = {
              authToken: await this.getAuthToken(),
              vehicleID: await this.getVehicleId(),
            };
            this.log('querying tesla for vehicle data...')
            const res = await tjs.vehicleDataAsync(options);
            if (res.vehicle_id && !res.reason) {
              this.vehicleData = res;
              this.isRunning = false;
              resolve(res);
            } else {
              this.log('error', res)
              this.isRunning = false;
              reject(res);
            }
          } 
          catch (err) {
            this.log("Tesla is asleep");
            this.isRunning = false;
            reject(err);
          }
      });
    }

    

    async getConnection(callback) {
      const st = await this.getState();
      if (st === "online") {
        return callback(null, true);
      }
      else{
        return callback(null, false);
      } 
    }

    async setConnection(callback) {
      try {
        const st = await this.getState();
        if (st === "online") {
          return callback(null, true);
        }
        else {
          const vehicleID = this.lastVehicleId;
          await this.wakeUp(vehicleID);
          return callback(null, true);
        }
      }
      catch (err) {  
        this.log("Waking Up Car")    
      }
    }
    

    async wakeUp(vehicleID, callback) {
      try {
        if (this.lastWakeupTS + 5000 < Date.now()) {
          this.lastWakeupTS = Date.now();
          await tjs.wakeUpAsync({
            authToken: this.token,
            vehicleID
          });
        }
        
        for (let i=0; i<20; i++) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          this.log('checking if tesla woken up')
          const res2 = await tjs.vehiclesAsync({
            authToken: this.token,
          });
          const state = res2[0].state;
          if (state !== 'asleep'){
            this.log("awake");
            return callback(null) // success
          }
        }
        this.log("Error waking Tesla: took too long to wake up")
        return callback(new Error("Error waking Tesla: took too long to wake up"));
      } catch (err) {
        this.log("Error waking Tesla: " + err)
        return callback(err);
      }
    }
    

    async getState() {
      if (this.isAsleep && this.lastStateFetchTime && Date.now() - this.lastStateFetchTime < 10000) {
        return this.isAsleep;
      }
      try {
        const res = await tjs.vehiclesAsync({
          authToken: this.token,
        });
        this.isAsleep = res[0].state;
        this.lastStateFetchTime = Date.now();
        return this.isAsleep;
      }catch {}
    }

     async getAuthToken(){
      if (this.token && this.tokenTS + 3600000 > Date.now()) {
        return this.token;
      }
        const request = require("axios");
  
        const config = {
          headers: {
            "x-tesla-user-agent": "TeslaApp/3.4.4-350/fad4a582e/android/8.1.0",
            "user-agent":"Mozilla/5.0 (Linux; Android 8.1.0; Pixel XL Build/OPM4.171019.021.D1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/68.0.3440.91 Mobile Safari/537.36"
          },
        }
  
        let re = await request.post('https://auth.tesla.com/oauth2/v3/token',{
          grant_type: "refresh_token",
          client_id: "ownerapi",
          refresh_token: this.ref,
          scope: "openid email offline_access"
        }, config)
        .catch(err => this.log(err));
        
        this.token = re.data.access_token;
        this.tokenTS = Date.now();
        return this.token;
      }

    async getVehicleId() {
      if (this.lastVehicleId && this.lastVehicleIdTS + 10000 > Date.now()) {
        return this.lastVehicleId;
      }
      this.log("querying tesla vehicle id and state...")
      
      try {
        const res = await tjs.vehiclesAsync({
          authToken: this.token,
        });
        const vehicleId = res[0].id;
        this.lastVehicleIdTS = Date.now();
        this.lastVehicleId = vehicleId;
        return this.lastVehicleId;
      } catch (err) {
        this.log("Error logging into Tesla: " + err)
        return Promise.reject(err);
      };
    }

    getServices() {
      return [
        this.temperatureService,
        this.lockService,
        this.trunkService,
        this.frunkService,
        this.batteryLevelService,
        this.Defrost,
        this.Venting,
        this.chargingService,
        this.chargeDoorService,
        this.HornService,
        this.LightsService,
        this.ConditioningService,
        this.Connection,
        this.SentryModeSwitch,
      ]
    }
  }
}