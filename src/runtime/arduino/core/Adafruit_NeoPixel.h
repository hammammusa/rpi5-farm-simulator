// Adafruit_NeoPixel (WS2812B) — common subset
#pragma once
#include "Arduino.h"

#define NEO_GRB 0x52
#define NEO_RGB 0x06
#define NEO_KHZ800 0x0000

class Adafruit_NeoPixel {
 public:
  Adafruit_NeoPixel(uint16_t n, int16_t pin, uint16_t type = NEO_GRB + NEO_KHZ800);
  ~Adafruit_NeoPixel();
  void begin() {}
  void show();
  void clear();
  void setPixelColor(uint16_t i, uint8_t r, uint8_t g, uint8_t b);
  void setPixelColor(uint16_t i, uint32_t c);
  void fill(uint32_t c, uint16_t first = 0, uint16_t count = 0);
  void setBrightness(uint8_t b) { bright_ = b; }
  uint16_t numPixels() const { return n_; }
  static uint32_t Color(uint8_t r, uint8_t g, uint8_t b) { return ((uint32_t)r << 16) | ((uint32_t)g << 8) | b; }

 private:
  uint16_t n_;
  int16_t pin_;
  uint8_t *rgb_;
  uint8_t bright_ = 255;
};
