// OneWire bus object; the DS18B20 search/read is done by DallasTemperature through the simulator
#pragma once
#include "Arduino.h"

typedef uint8_t DeviceAddress[8];

class OneWire {
 public:
  explicit OneWire(uint8_t pin) : pin_(pin) {}
  uint8_t pin() const { return pin_; }

 private:
  uint8_t pin_;
};
