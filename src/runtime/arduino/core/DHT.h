// DHT sensor library (Adafruit API): DHT11 / DHT22 / AM2302
#pragma once
#include "Arduino.h"

#define DHT11 11
#define DHT12 12
#define DHT21 21
#define DHT22 22
#define AM2301 21
#define AM2302 22

class DHT {
 public:
  DHT(uint8_t pin, uint8_t type, uint8_t count = 6) : pin_(pin), type_(type) {}
  void begin(uint8_t usec = 55) { hal_pin_mode(pin_, INPUT_PULLUP); }
  float readTemperature(bool fahrenheit = false, bool force = false);
  float readHumidity(bool force = false);
  float computeHeatIndex(float t, float h, bool fahrenheit = true);
  float convertCtoF(float c) { return c * 1.8f + 32; }
  bool read(bool force = false);

 private:
  uint8_t pin_, type_;
  float t_ = NAN, h_ = NAN;
  unsigned long last_ = 0;
  bool have_ = false, ok_ = false;
};
