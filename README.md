# Homebridge-bloody-tesla (WIP)

A [homebridge](https://github.com/nfarina/homebridge) plugin, by which you can control your tesla with Homekit and Siri.

Install the plugin:

    sudo npm -g install homebridge-bloody-tesla

Add the following to config.json:

    {
      "accessories": [
        {
          "accessory": "Tesla",
          "name": "Model S",
          "vin": "XXXXXXX",
          "token": "XXXXXXX",
        }
      ]
    }

Main reason for this pluggin is to expose climate as thermostat in homekit which allows you to control heating and cooling and set temperature.


