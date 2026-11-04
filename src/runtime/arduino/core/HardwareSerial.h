// Serial (USB-UART console = UART0) and Serial1/Serial2 on any pins
#pragma once
#include "Print.h"

class Stream : public Print {
 public:
  virtual int available() = 0;
  virtual int read() = 0;
  virtual int peek() { return -1; }
  void setTimeout(unsigned long ms) { timeout_ = ms; }
  String readString();
  String readStringUntil(char terminator);
  size_t readBytes(uint8_t *buf, size_t n);
  size_t readBytes(char *buf, size_t n) { return readBytes((uint8_t *)buf, n); }
  long parseInt();
  float parseFloat();

 protected:
  unsigned long timeout_ = 1000;
  int timedRead();
};

class HardwareSerial : public Stream {
 public:
  explicit HardwareSerial(int port) : port_(port) {}
  void begin(unsigned long baud, uint32_t config = 0x800001c, int8_t rxPin = -1, int8_t txPin = -1);
  void end();
  int available() override;
  int read() override;
  int peek() override;
  size_t write(uint8_t c) override { return write(&c, 1); }
  size_t write(const uint8_t *buf, size_t n) override;
  using Print::write;
  operator bool() const { return true; }

 private:
  int port_;
  int peeked_ = -1;
};

extern HardwareSerial Serial;
extern HardwareSerial Serial1;
extern HardwareSerial Serial2;
