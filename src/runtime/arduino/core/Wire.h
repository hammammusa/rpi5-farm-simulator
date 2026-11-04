// Wire (I2C master) — TwoWire API of the Arduino-ESP32 core
#pragma once
#include "Arduino.h"

class TwoWire : public Stream {
 public:
  explicit TwoWire(int bus) : bus_(bus) {}
  bool begin(int sda = -1, int scl = -1, uint32_t frequency = 0);
  bool setPins(int sda, int scl);
  void setClock(uint32_t) {}
  void beginTransmission(uint8_t addr);
  uint8_t endTransmission(bool sendStop = true);
  uint8_t requestFrom(uint8_t addr, uint8_t quantity, bool sendStop = true);
  size_t write(uint8_t c) override;
  size_t write(const uint8_t *buf, size_t n) override;
  using Print::write;
  int available() override { return rxLen_ - rxPos_; }
  int read() override { return rxPos_ < rxLen_ ? rxBuf_[rxPos_++] : -1; }
  int peek() override { return rxPos_ < rxLen_ ? rxBuf_[rxPos_] : -1; }

 private:
  int bus_;
  int sda_ = -1, scl_ = -1;
  bool started_ = false;
  uint8_t addr_ = 0;
  uint8_t txBuf_[128];
  int txLen_ = 0;
  uint8_t rxBuf_[128];
  int rxLen_ = 0, rxPos_ = 0;
};

extern TwoWire Wire;
extern TwoWire Wire1;
