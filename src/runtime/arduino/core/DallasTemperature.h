// DallasTemperature (DS18B20) — common subset of the library API
#pragma once
#include "OneWire.h"

#define DEVICE_DISCONNECTED_C -127

class DallasTemperature {
 public:
  explicit DallasTemperature(OneWire *ow) : ow_(ow) {}
  void begin();
  uint8_t getDeviceCount() { return count_; }
  bool getAddress(uint8_t *addr, uint8_t index);
  void requestTemperatures();
  float getTempCByIndex(uint8_t index);
  float getTempC(const uint8_t *addr);
  float getTempFByIndex(uint8_t index) { return getTempCByIndex(index) * 1.8f + 32; }
  void setResolution(uint8_t) {}
  void setWaitForConversion(bool w) { wait_ = w; }

 private:
  OneWire *ow_;
  uint8_t roms_[8][8];
  uint8_t count_ = 0;
  bool wait_ = true;
};
