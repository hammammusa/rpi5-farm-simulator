// Arduino Print: print/println/printf on top of write()
#pragma once
#include <stdint.h>
#include <stddef.h>
#include "WString.h"

class Print {
 public:
  virtual ~Print() {}
  virtual size_t write(uint8_t c) = 0;
  virtual size_t write(const uint8_t *buf, size_t n);
  size_t write(const char *s);
  size_t write(const char *buf, size_t n) { return write((const uint8_t *)buf, n); }
  size_t print(const char *s) { return write(s); }
  size_t print(const String &s) { return write(s.c_str()); }
  size_t print(char c) { return write((uint8_t)c); }
  size_t print(unsigned char v, int base = 10) { return print((unsigned long)v, base); }
  size_t print(int v, int base = 10) { return print((long)v, base); }
  size_t print(unsigned int v, int base = 10) { return print((unsigned long)v, base); }
  size_t print(long v, int base = 10);
  size_t print(unsigned long v, int base = 10);
  size_t print(long long v, int base = 10) { return print((long)v, base); }
  size_t print(unsigned long long v, int base = 10) { return print((unsigned long)v, base); }
  size_t print(double v, int digits = 2);
  size_t print(bool b) { return print(b ? 1 : 0); }
  size_t println() { return write("\r\n"); }
  template <typename T>
  size_t println(const T &v) {
    size_t n = print(v);
    return n + println();
  }
  template <typename T>
  size_t println(const T &v, int fmt) {
    size_t n = print(v, fmt);
    return n + println();
  }
  size_t printf(const char *fmt, ...) __attribute__((format(printf, 2, 3)));
  void flush() {}
};
