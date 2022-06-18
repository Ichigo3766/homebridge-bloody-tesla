const createTesla = require("./createTesla")

module.exports = function register(homebridge) {
  const Service = homebridge.hap.Service
  const Characteristic = homebridge.hap.Characteristic
  homebridge.registerAccessory('homebridge-tesla-bloodsucker', 'Tesla', createTesla({
    Service,
    Characteristic,
  }));
}