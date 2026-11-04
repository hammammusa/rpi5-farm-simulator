// Implementation of the simulator's Arduino-ESP32 core subset. Compiled with the sketch by
// Clang (wasm32, freestanding): a small C library (heap, strings, printf) plus the Arduino
// classes, all hardware access going through the HAL imports in hal.h.
#include "Arduino.h"
#include "Wire.h"
#include "DHT.h"
#include "DallasTemperature.h"
#include "Adafruit_NeoPixel.h"
#include "WiFi.h"

#define EXPORT(name) __attribute__((export_name(#name)))

// ------------------------------------------------------------------ heap (first-fit free list)
extern "C" unsigned char __heap_base;
namespace {
struct Block {
  size_t size;  // payload bytes
  Block *next;  // next free block (only while free)
};
unsigned char *heapTop = nullptr;
unsigned char *heapEnd = nullptr;
Block *freeList = nullptr;
size_t heapUsed = 0;
const size_t ALIGN = 8;

size_t roundUp(size_t n) { return (n + ALIGN - 1) & ~(ALIGN - 1); }

bool growTo(unsigned char *need) {
  while (need > heapEnd) {
    if (__builtin_wasm_memory_grow(0, 1) == (size_t)-1) return false;
    heapEnd += 65536;
  }
  return true;
}
}  // namespace

extern "C" void *malloc(size_t n) {
  if (!heapTop) {
    heapTop = (unsigned char *)roundUp((size_t)&__heap_base);
    heapEnd = (unsigned char *)(__builtin_wasm_memory_size(0) * 65536);
  }
  n = roundUp(n ? n : 1);
  Block **pp = &freeList;
  while (*pp) {
    if ((*pp)->size >= n) {
      Block *b = *pp;
      *pp = b->next;
      heapUsed += b->size;
      return (unsigned char *)b + sizeof(Block);
    }
    pp = &(*pp)->next;
  }
  unsigned char *p = heapTop;
  if (!growTo(p + sizeof(Block) + n)) return nullptr;
  heapTop = p + sizeof(Block) + n;
  Block *b = (Block *)p;
  b->size = n;
  heapUsed += n;
  return p + sizeof(Block);
}

extern "C" void free(void *p) {
  if (!p) return;
  Block *b = (Block *)((unsigned char *)p - sizeof(Block));
  heapUsed -= b->size;
  b->next = freeList;
  freeList = b;
}

extern "C" void *calloc(size_t a, size_t b) {
  void *p = malloc(a * b);
  if (p) memset(p, 0, a * b);
  return p;
}

extern "C" void *realloc(void *p, size_t n) {
  if (!p) return malloc(n);
  Block *b = (Block *)((unsigned char *)p - sizeof(Block));
  if (b->size >= n) return p;
  void *q = malloc(n);
  if (q) memcpy(q, p, b->size);
  free(p);
  return q;
}

void *operator new(size_t n) { return malloc(n); }
void *operator new[](size_t n) { return malloc(n); }
void operator delete(void *p) noexcept { free(p); }
void operator delete[](void *p) noexcept { free(p); }
void operator delete(void *p, size_t) noexcept { free(p); }
void operator delete[](void *p, size_t) noexcept { free(p); }
extern "C" void __cxa_pure_virtual() { __builtin_trap(); }
extern "C" int __cxa_atexit(void (*)(void *), void *, void *) { return 0; }
void *__dso_handle = nullptr;

// ------------------------------------------------------------------ C strings
extern "C" {
void *memcpy(void *d, const void *s, size_t n) {
  unsigned char *a = (unsigned char *)d;
  const unsigned char *b = (const unsigned char *)s;
  while (n--) *a++ = *b++;
  return d;
}
void *memmove(void *d, const void *s, size_t n) {
  unsigned char *a = (unsigned char *)d;
  const unsigned char *b = (const unsigned char *)s;
  if (a < b)
    while (n--) *a++ = *b++;
  else {
    a += n;
    b += n;
    while (n--) *--a = *--b;
  }
  return d;
}
void *memset(void *d, int c, size_t n) {
  unsigned char *a = (unsigned char *)d;
  while (n--) *a++ = (unsigned char)c;
  return d;
}
int memcmp(const void *x, const void *y, size_t n) {
  const unsigned char *a = (const unsigned char *)x, *b = (const unsigned char *)y;
  for (; n; n--, a++, b++)
    if (*a != *b) return *a - *b;
  return 0;
}
size_t strlen(const char *s) {
  size_t n = 0;
  while (s[n]) n++;
  return n;
}
int strcmp(const char *a, const char *b) {
  while (*a && *a == *b) a++, b++;
  return (unsigned char)*a - (unsigned char)*b;
}
int strncmp(const char *a, const char *b, size_t n) {
  for (; n; n--, a++, b++) {
    if (*a != *b) return (unsigned char)*a - (unsigned char)*b;
    if (!*a) return 0;
  }
  return 0;
}
char *strcpy(char *d, const char *s) {
  char *r = d;
  while ((*d++ = *s++)) {
  }
  return r;
}
char *strncpy(char *d, const char *s, size_t n) {
  size_t i = 0;
  for (; i < n && s[i]; i++) d[i] = s[i];
  for (; i < n; i++) d[i] = 0;
  return d;
}
char *strcat(char *d, const char *s) {
  strcpy(d + strlen(d), s);
  return d;
}
const char *strchr(const char *s, int c) {
  for (; *s; s++)
    if (*s == (char)c) return s;
  return c ? nullptr : s;
}
const char *strstr(const char *h, const char *n) {
  size_t k = strlen(n);
  if (!k) return h;
  for (; *h; h++)
    if (!strncmp(h, n, k)) return h;
  return nullptr;
}
static bool isSpace(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v'; }
long strtol(const char *s, char **end, int base) {
  while (isSpace(*s)) s++;
  int sign = 1;
  if (*s == '-' || *s == '+') sign = (*s++ == '-') ? -1 : 1;
  if ((base == 0 || base == 16) && s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) s += 2, base = 16;
  if (base == 0) base = 10;
  long v = 0;
  for (;; s++) {
    int d = *s >= '0' && *s <= '9' ? *s - '0' : *s >= 'a' && *s <= 'z' ? *s - 'a' + 10 : *s >= 'A' && *s <= 'Z' ? *s - 'A' + 10 : 99;
    if (d >= base) break;
    v = v * base + d;
  }
  if (end) *end = (char *)s;
  return sign * v;
}
double strtod(const char *s, char **end) {
  while (isSpace(*s)) s++;
  double sign = 1;
  if (*s == '-' || *s == '+') sign = (*s++ == '-') ? -1 : 1;
  double v = 0;
  while (*s >= '0' && *s <= '9') v = v * 10 + (*s++ - '0');
  if (*s == '.') {
    double f = 0.1;
    for (s++; *s >= '0' && *s <= '9'; s++, f /= 10) v += (*s - '0') * f;
  }
  if (*s == 'e' || *s == 'E') {
    char *e;
    long x = strtol(s + 1, &e, 10);
    if (e != s + 1) {
      s = e;
      v *= pow(10.0, (double)x);
    }
  }
  if (end) *end = (char *)s;
  return sign * v;
}
int atoi(const char *s) { return (int)strtol(s, nullptr, 10); }
long atol(const char *s) { return strtol(s, nullptr, 10); }
double atof(const char *s) { return strtod(s, nullptr); }
int abs(int x) { return x < 0 ? -x : x; }
long labs(long x) { return x < 0 ? -x : x; }

static char *utoaBase(unsigned long v, char *buf, int base, bool upper = false) {
  char tmp[34];
  int i = 0;
  if (base < 2 || base > 36) base = 10;
  do {
    int d = v % base;
    tmp[i++] = (char)(d < 10 ? '0' + d : (upper ? 'A' : 'a') + d - 10);
    v /= base;
  } while (v);
  int j = 0;
  while (i) buf[j++] = tmp[--i];
  buf[j] = 0;
  return buf;
}
char *ltoa(long v, char *buf, int base) {
  if (v < 0 && base == 10) {
    buf[0] = '-';
    utoaBase((unsigned long)(-v), buf + 1, base);
    return buf;
  }
  return utoaBase((unsigned long)v, buf, base);
}
char *itoa(int v, char *buf, int base) { return ltoa(v, buf, base); }
char *utoa(unsigned v, char *buf, int base) { return utoaBase(v, buf, base); }

/** fixed-point formatting of a double with `prec` decimals */
static int fmtFloat(char *out, double v, int prec) {
  char *p = out;
  if (__builtin_isnan(v)) return (int)(strcpy(out, "nan"), 3);
  if (__builtin_isinf(v)) return (int)(strcpy(out, v < 0 ? "-inf" : "inf"), v < 0 ? 4 : 3);
  if (v < 0) *p++ = '-', v = -v;
  if (prec > 9) prec = 9;
  double scale = 1;
  for (int i = 0; i < prec; i++) scale *= 10;
  double r = v * scale + 0.5;
  if (r > 1.8e19) {  // too large for 64-bit integer formatting
    strcpy(p, "ovf");
    return (int)(p - out) + 3;
  }
  unsigned long long whole = (unsigned long long)r;
  unsigned long long ip = whole / (unsigned long long)scale, fp = whole % (unsigned long long)scale;
  char tmp[24];
  int i = 0;
  do tmp[i++] = (char)('0' + ip % 10), ip /= 10;
  while (ip);
  while (i) *p++ = tmp[--i];
  if (prec > 0) {
    *p++ = '.';
    for (int k = prec - 1; k >= 0; k--) {
      p[k] = (char)('0' + fp % 10);
      fp /= 10;
    }
    p += prec;
  }
  *p = 0;
  return (int)(p - out);
}

char *dtostrf(double v, signed char width, unsigned char prec, char *buf) {
  char tmp[40];
  int n = fmtFloat(tmp, v, prec);
  int pad = width > n ? width - n : 0;
  for (int i = 0; i < pad; i++) buf[i] = ' ';
  memcpy(buf + pad, tmp, n + 1);
  return buf;
}

int vsnprintf(char *out, size_t cap, const char *f, va_list ap) {
  size_t n = 0;
  auto put = [&](char c) {
    if (n + 1 < cap) out[n] = c;
    n++;
  };
  for (; *f; f++) {
    if (*f != '%') {
      put(*f);
      continue;
    }
    f++;
    bool left = false, zero = false, plus = false;
    for (;; f++) {
      if (*f == '-') left = true;
      else if (*f == '0') zero = true;
      else if (*f == '+') plus = true;
      else if (*f == ' ') {
      } else break;
    }
    int width = 0, prec = -1;
    if (*f == '*') width = va_arg(ap, int), f++;
    while (*f >= '0' && *f <= '9') width = width * 10 + (*f++ - '0');
    if (*f == '.') {
      f++;
      prec = 0;
      if (*f == '*') prec = va_arg(ap, int), f++;
      while (*f >= '0' && *f <= '9') prec = prec * 10 + (*f++ - '0');
    }
    int lng = 0;
    while (*f == 'l' || *f == 'h' || *f == 'z') {
      if (*f == 'l') lng++;
      f++;
    }
    char buf[72];
    const char *s = buf;
    int len = 0;
    switch (*f) {
      case 'd':
      case 'i': {
        long long v = lng >= 2 ? va_arg(ap, long long) : lng == 1 ? va_arg(ap, long) : va_arg(ap, int);
        char *b = buf;
        if (v < 0) *b++ = '-', v = -v;
        else if (plus) *b++ = '+';
        utoaBase((unsigned long)v, b, 10);
        len = (int)strlen(buf);
        break;
      }
      case 'u':
      case 'x':
      case 'X':
      case 'o': {
        unsigned long long v = lng >= 2 ? va_arg(ap, unsigned long long) : lng == 1 ? va_arg(ap, unsigned long) : va_arg(ap, unsigned int);
        utoaBase((unsigned long)v, buf, *f == 'u' ? 10 : *f == 'o' ? 8 : 16, *f == 'X');
        len = (int)strlen(buf);
        break;
      }
      case 'f':
      case 'F':
      case 'g':
      case 'e': {
        double v = va_arg(ap, double);
        char *b = buf;
        if (plus && v >= 0) *b++ = '+';
        fmtFloat(b, v, prec < 0 ? 6 : prec);
        len = (int)strlen(buf);
        break;
      }
      case 'c':
        buf[0] = (char)va_arg(ap, int);
        buf[1] = 0;
        len = 1;
        break;
      case 's':
        s = va_arg(ap, const char *);
        if (!s) s = "(null)";
        len = (int)strlen(s);
        if (prec >= 0 && len > prec) len = prec;
        break;
      case 'p':
        buf[0] = '0', buf[1] = 'x';
        utoaBase((unsigned long)va_arg(ap, void *), buf + 2, 16);
        len = (int)strlen(buf);
        break;
      case '%':
        buf[0] = '%', buf[1] = 0, len = 1;
        break;
      default:
        buf[0] = '%', buf[1] = *f, buf[2] = 0, len = 2;
        if (!*f) f--;
    }
    int pad = width > len ? width - len : 0;
    if (!left)
      for (int i = 0; i < pad; i++) put(zero && *f != 's' ? '0' : ' ');
    for (int i = 0; i < len; i++) put(s[i]);
    if (left)
      for (int i = 0; i < pad; i++) put(' ');
  }
  if (cap) out[n < cap ? n : cap - 1] = 0;
  return (int)n;
}
int snprintf(char *out, size_t cap, const char *f, ...) {
  va_list ap;
  va_start(ap, f);
  int n = vsnprintf(out, cap, f, ap);
  va_end(ap);
  return n;
}
int sprintf(char *out, const char *f, ...) {
  va_list ap;
  va_start(ap, f);
  int n = vsnprintf(out, 4096, f, ap);
  va_end(ap);
  return n;
}
}  // extern "C"

// ------------------------------------------------------------------ String
void String::set(const char *s, unsigned int n) {
  reserve(n);
  if (buf_) {
    memcpy(buf_, s, n);
    buf_[n] = 0;
    len_ = n;
  }
}
bool String::reserve(unsigned int n) {
  if (buf_ && cap_ >= n) return true;
  char *nb = (char *)realloc(buf_, n + 1);
  if (!nb) return false;
  if (!buf_) nb[0] = 0;
  buf_ = nb;
  cap_ = n;
  return true;
}
String::String(const char *s) { set(s ? s : "", s ? (unsigned)strlen(s) : 0); }
String::String(const String &s) { set(s.c_str(), s.len_); }
String::String(String &&s) : buf_(s.buf_), len_(s.len_), cap_(s.cap_) { s.buf_ = nullptr, s.len_ = s.cap_ = 0; }
String::String(char c) {
  char b[2] = {c, 0};
  set(b, 1);
}
String::String(int v, unsigned char base) {
  char b[34];
  set(ltoa(v, b, base), (unsigned)strlen(b));
}
String::String(unsigned int v, unsigned char base) {
  char b[34];
  set(utoa(v, b, base), (unsigned)strlen(b));
}
String::String(long v, unsigned char base) {
  char b[34];
  set(ltoa(v, b, base), (unsigned)strlen(b));
}
String::String(unsigned long v, unsigned char base) {
  char b[34];
  set(utoaBase(v, b, base), (unsigned)strlen(b));
}
String::String(float v, unsigned char d) {
  char b[40];
  set(b, (unsigned)fmtFloat(b, v, d));
}
String::String(double v, unsigned char d) {
  char b[40];
  set(b, (unsigned)fmtFloat(b, v, d));
}
String::~String() { free(buf_); }
String &String::operator=(const String &s) {
  if (this != &s) set(s.c_str(), s.len_);
  return *this;
}
String &String::operator=(String &&s) {
  if (this != &s) {
    free(buf_);
    buf_ = s.buf_, len_ = s.len_, cap_ = s.cap_;
    s.buf_ = nullptr, s.len_ = s.cap_ = 0;
  }
  return *this;
}
String &String::operator=(const char *s) {
  set(s ? s : "", s ? (unsigned)strlen(s) : 0);
  return *this;
}
String &String::concat(const char *s) {
  unsigned n = (unsigned)strlen(s);
  if (!reserve(len_ + n)) return *this;
  memcpy(buf_ + len_, s, n + 1);
  len_ += n;
  return *this;
}
String &String::concat(const String &s) {
  String copy(s);  // s may be *this
  return concat(copy.c_str());
}
String &String::concat(char c) {
  char b[2] = {c, 0};
  return concat(b);
}
bool String::equals(const String &s) const { return len_ == s.len_ && !strcmp(c_str(), s.c_str()); }
bool String::equals(const char *s) const { return !strcmp(c_str(), s ? s : ""); }
static char lower(char c) { return c >= 'A' && c <= 'Z' ? c + 32 : c; }
bool String::equalsIgnoreCase(const String &s) const {
  if (len_ != s.len_) return false;
  for (unsigned i = 0; i < len_; i++)
    if (lower(buf_[i]) != lower(s.buf_[i])) return false;
  return true;
}
int String::compareTo(const String &s) const { return strcmp(c_str(), s.c_str()); }
bool String::startsWith(const String &s) const { return s.len_ <= len_ && !strncmp(c_str(), s.c_str(), s.len_); }
bool String::endsWith(const String &s) const { return s.len_ <= len_ && !strcmp(c_str() + len_ - s.len_, s.c_str()); }
int String::indexOf(char c, unsigned from) const {
  for (unsigned i = from; i < len_; i++)
    if (buf_[i] == c) return (int)i;
  return -1;
}
int String::indexOf(const String &s, unsigned from) const {
  if (from > len_) return -1;
  const char *p = strstr(c_str() + from, s.c_str());
  return p ? (int)(p - c_str()) : -1;
}
int String::lastIndexOf(char c) const {
  for (int i = (int)len_ - 1; i >= 0; i--)
    if (buf_[i] == c) return i;
  return -1;
}
String String::substring(unsigned from, unsigned to) const {
  if (from > to) {
    unsigned t = from;
    from = to, to = t;
  }
  if (from > len_) from = len_;
  if (to > len_) to = len_;
  String r;
  r.set(c_str() + from, to - from);
  return r;
}
void String::replace(const String &find, const String &repl) {
  if (!find.len_) return;
  String out;
  unsigned i = 0;
  while (i < len_) {
    if (!strncmp(c_str() + i, find.c_str(), find.len_)) {
      out.concat(repl);
      i += find.len_;
    } else out.concat(buf_[i++]);
  }
  *this = out;
}
void String::remove(unsigned index, unsigned count) {
  if (index >= len_) return;
  if (count > len_ - index) count = len_ - index;
  memmove(buf_ + index, buf_ + index + count, len_ - index - count + 1);
  len_ -= count;
}
void String::toUpperCase() {
  for (unsigned i = 0; i < len_; i++)
    if (buf_[i] >= 'a' && buf_[i] <= 'z') buf_[i] -= 32;
}
void String::toLowerCase() {
  for (unsigned i = 0; i < len_; i++) buf_[i] = lower(buf_[i]);
}
void String::trim() {
  unsigned a = 0, b = len_;
  while (a < b && isSpace(buf_[a])) a++;
  while (b > a && isSpace(buf_[b - 1])) b--;
  *this = substring(a, b);
}
long String::toInt() const { return atol(c_str()); }
float String::toFloat() const { return (float)atof(c_str()); }
double String::toDouble() const { return atof(c_str()); }
String operator+(const String &a, const String &b) {
  String r(a);
  return r.concat(b), r;
}
String operator+(const String &a, const char *b) {
  String r(a);
  return r.concat(b), r;
}
String operator+(const char *a, const String &b) {
  String r(a);
  return r.concat(b), r;
}
String operator+(const String &a, char b) { return a + String(b); }
String operator+(const String &a, int b) { return a + String(b); }
String operator+(const String &a, unsigned int b) { return a + String(b); }
String operator+(const String &a, long b) { return a + String(b); }
String operator+(const String &a, unsigned long b) { return a + String(b); }
String operator+(const String &a, float b) { return a + String(b); }
String operator+(const String &a, double b) { return a + String(b); }

// ------------------------------------------------------------------ Print / Stream / Serial
size_t Print::write(const uint8_t *buf, size_t n) {
  size_t k = 0;
  while (n--) k += write(*buf++);
  return k;
}
size_t Print::write(const char *s) { return s ? write((const uint8_t *)s, strlen(s)) : 0; }
size_t Print::print(long v, int base) {
  char b[40];
  return write(ltoa(v, b, base));
}
size_t Print::print(unsigned long v, int base) {
  char b[40];
  return write(utoaBase(v, b, base));
}
size_t Print::print(double v, int digits) {
  char b[48];
  fmtFloat(b, v, digits);
  return write(b);
}
size_t Print::printf(const char *fmt, ...) {
  char small[256];
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(small, sizeof small, fmt, ap);
  va_end(ap);
  if (n < (int)sizeof small) return write((const uint8_t *)small, n);
  char *big = (char *)malloc(n + 1);
  va_start(ap, fmt);
  vsnprintf(big, n + 1, fmt, ap);
  va_end(ap);
  size_t k = write((const uint8_t *)big, n);
  free(big);
  return k;
}

int Stream::timedRead() {
  unsigned long start = millis();
  do {
    int c = read();
    if (c >= 0) return c;
    delay(1);
  } while (millis() - start < timeout_);
  return -1;
}
String Stream::readString() {
  String s;
  for (int c = timedRead(); c >= 0; c = timedRead()) s += (char)c;
  return s;
}
String Stream::readStringUntil(char t) {
  String s;
  for (int c = timedRead(); c >= 0 && c != t; c = timedRead()) s += (char)c;
  return s;
}
size_t Stream::readBytes(uint8_t *buf, size_t n) {
  size_t k = 0;
  while (k < n) {
    int c = timedRead();
    if (c < 0) break;
    buf[k++] = (uint8_t)c;
  }
  return k;
}
long Stream::parseInt() {
  String s = readStringUntil('\n');
  return s.toInt();
}
float Stream::parseFloat() {
  String s = readStringUntil('\n');
  return s.toFloat();
}

void HardwareSerial::begin(unsigned long baud, uint32_t, int8_t rx, int8_t tx) { hal_serial_begin(port_, (int)baud, rx, tx); }
void HardwareSerial::end() { hal_serial_end(port_); }
int HardwareSerial::available() { return (peeked_ >= 0 ? 1 : 0) + hal_serial_available(port_); }
int HardwareSerial::read() {
  if (peeked_ >= 0) {
    int c = peeked_;
    peeked_ = -1;
    return c;
  }
  return hal_serial_read(port_);
}
int HardwareSerial::peek() {
  if (peeked_ < 0) peeked_ = hal_serial_read(port_);
  return peeked_;
}
size_t HardwareSerial::write(const uint8_t *buf, size_t n) {
  hal_serial_write(port_, buf, (int)n);
  return n;
}
HardwareSerial Serial(0);
HardwareSerial Serial1(1);
HardwareSerial Serial2(2);

// ------------------------------------------------------------------ GPIO, ADC, PWM, time
namespace {
uint8_t adcBits = 12;
uint8_t pinAtten[40];
bool attenSet[40];
adc_attenuation_t defaultAtten = ADC_11db;
const int ATTEN_DB[4] = {0, 2, 6, 11};  // 2 → 2.5 dB (host maps it)
struct Pwm {
  int8_t pin = -1;
  uint32_t freq = 0;
  uint8_t bits = 8;
  uint32_t duty = 0;
};
Pwm pwmPins[40];        // by pin (3.x API, analogWrite)
int8_t channelPin[16];  // 2.x API: channel → pin
uint32_t channelFreq[16];
uint8_t channelBits[16];
bool channelsInit = false;
voidFuncPtr isr[40];
uint32_t awFreq[40];
uint8_t awBits[40];

void initChannels() {
  if (channelsInit) return;
  for (int i = 0; i < 16; i++) channelPin[i] = -1;
  channelsInit = true;
}
void applyPwm(int pin) {
  Pwm &p = pwmPins[pin];
  double full = (double)((1u << p.bits) - 1);
  double duty = p.duty >= (1u << p.bits) ? 1.0 : p.duty / (full > 0 ? full + 1 : 1);
  if (p.duty >= (uint32_t)full && p.bits < 20) duty = 1.0;
  hal_pwm_set(pin, (double)p.freq, duty);
}
int attenOf(uint8_t pin) { return ATTEN_DB[pin < 40 && attenSet[pin] ? pinAtten[pin] : defaultAtten]; }
}  // namespace

void pinMode(uint8_t pin, uint8_t mode) {
  if (pin < 40) pwmPins[pin].pin = -1;
  hal_pin_mode(pin, mode);
}
void digitalWrite(uint8_t pin, uint8_t val) { hal_digital_write(pin, val ? 1 : 0); }
int digitalRead(uint8_t pin) { return hal_digital_read(pin); }
uint16_t analogRead(uint8_t pin) { return (uint16_t)hal_analog_read(pin, adcBits, attenOf(pin)); }
uint32_t analogReadMilliVolts(uint8_t pin) { return (uint32_t)hal_analog_read_mv(pin, attenOf(pin)); }
void analogReadResolution(uint8_t bits) { adcBits = bits < 9 ? 9 : bits > 12 ? 12 : bits; }
void analogSetAttenuation(adc_attenuation_t a) { defaultAtten = a; }
void analogSetPinAttenuation(uint8_t pin, adc_attenuation_t a) {
  if (pin < 40) pinAtten[pin] = (uint8_t)a, attenSet[pin] = true;
}
void dacWrite(uint8_t pin, uint8_t value) { hal_dac_write(pin, value); }

bool ledcAttach(uint8_t pin, uint32_t freq, uint8_t res) {
  if (pin >= 40 || res < 1 || res > 20) return false;
  pwmPins[pin].pin = (int8_t)pin;
  pwmPins[pin].freq = freq;
  pwmPins[pin].bits = res;
  pwmPins[pin].duty = 0;
  applyPwm(pin);
  return true;
}
bool ledcAttachChannel(uint8_t pin, uint32_t freq, uint8_t res, int8_t) { return ledcAttach(pin, freq, res); }
bool ledcWrite(uint8_t pinOrChannel, uint32_t duty) {
  initChannels();
  int pin = pinOrChannel;
  // Arduino-ESP32 2.x: ledcWrite(channel, duty) after ledcSetup/ledcAttachPin
  if (pinOrChannel < 16 && channelPin[pinOrChannel] >= 0 && pwmPins[pinOrChannel].pin != pinOrChannel) pin = channelPin[pinOrChannel];
  if (pin >= 40 || pwmPins[pin].pin < 0) return false;
  pwmPins[pin].duty = duty;
  applyPwm(pin);
  return true;
}
uint32_t ledcRead(uint8_t pin) { return pin < 40 ? pwmPins[pin].duty : 0; }
uint32_t ledcWriteTone(uint8_t pin, uint32_t freq) {
  if (pin >= 40) return 0;
  if (!freq) {
    pwmPins[pin].duty = 0;
    applyPwm(pin);
    return 0;
  }
  pwmPins[pin].pin = (int8_t)pin;
  pwmPins[pin].freq = freq;
  pwmPins[pin].bits = 10;
  pwmPins[pin].duty = 512;
  applyPwm(pin);
  return freq;
}
bool ledcDetach(uint8_t pin) {
  if (pin >= 40) return false;
  pwmPins[pin].pin = -1;
  hal_pwm_stop(pin);
  return true;
}
uint32_t ledcSetup(uint8_t ch, uint32_t freq, uint8_t res) {
  initChannels();
  if (ch >= 16) return 0;
  channelFreq[ch] = freq;
  channelBits[ch] = res;
  return freq;
}
void ledcAttachPin(uint8_t pin, uint8_t ch) {
  initChannels();
  if (ch >= 16) return;
  channelPin[ch] = (int8_t)pin;
  ledcAttach(pin, channelFreq[ch] ? channelFreq[ch] : 5000, channelBits[ch] ? channelBits[ch] : 8);
}
void ledcDetachPin(uint8_t pin) { ledcDetach(pin); }
void analogWrite(uint8_t pin, int value) {
  if (pin >= 40) return;
  if (pwmPins[pin].pin != (int8_t)pin) ledcAttach(pin, awFreq[pin] ? awFreq[pin] : 1000, awBits[pin] ? awBits[pin] : 8);
  ledcWrite(pin, value < 0 ? 0 : (uint32_t)value);
}
void analogWriteFrequency(uint8_t pin, uint32_t f) {
  if (pin < 40) awFreq[pin] = f;
}
void analogWriteResolution(uint8_t pin, uint8_t bits) {
  if (pin < 40) awBits[pin] = bits;
}
void tone(uint8_t pin, unsigned int f, unsigned long duration) {
  ledcWriteTone(pin, f);
  if (duration) {
    delay(duration);
    ledcWriteTone(pin, 0);
  }
}
void noTone(uint8_t pin) { ledcWriteTone(pin, 0); }
unsigned long pulseIn(uint8_t pin, uint8_t state, unsigned long timeout) {
  unsigned long start = micros();
  while (digitalRead(pin) == state)
    if (micros() - start > timeout) return 0;
  while (digitalRead(pin) != state)
    if (micros() - start > timeout) return 0;
  unsigned long t0 = micros();
  while (digitalRead(pin) == state)
    if (micros() - start > timeout) return 0;
  return micros() - t0;
}

void attachInterrupt(uint8_t pin, voidFuncPtr handler, int mode) {
  if (pin >= 40) return;
  isr[pin] = handler;
  hal_attach_interrupt(pin, mode);
}
void detachInterrupt(uint8_t pin) {
  if (pin >= 40) return;
  isr[pin] = nullptr;
  hal_detach_interrupt(pin);
}
void interrupts() {}
void noInterrupts() {}

void delay(uint32_t ms) { hal_delay_ms(ms); }
void delayMicroseconds(uint32_t us) { hal_delay_ms(us / 1000.0); }
unsigned long millis() { return (unsigned long)(uint64_t)hal_millis(); }
unsigned long micros() { return (unsigned long)(uint64_t)hal_micros(); }
void yield() { hal_delay_ms(0); }

namespace {
uint32_t rngState = 0;
}
void randomSeed(unsigned long seed) { rngState = seed ? (uint32_t)seed : 1; }
uint32_t esp_random() { return hal_random_u32(); }
static uint32_t nextRandom() {
  if (!rngState) return hal_random_u32();
  rngState ^= rngState << 13;
  rngState ^= rngState >> 17;
  rngState ^= rngState << 5;
  return rngState;
}
long random(long mx) { return mx <= 0 ? 0 : (long)(nextRandom() % (uint32_t)mx); }
long random(long mn, long mx) { return mx <= mn ? mn : mn + random(mx - mn); }
long map(long x, long a, long b, long c, long d) { return b == a ? c : (x - a) * (d - c) / (b - a) + c; }

EspClass ESP;
void EspClass::restart() { hal_restart(); }
uint32_t EspClass::getFreeHeap() { return 300000 - (uint32_t)heapUsed; }
uint64_t EspClass::getEfuseMac() { return 0x240AC4000000ULL; }

// ------------------------------------------------------------------ Wire
TwoWire Wire(0);
TwoWire Wire1(1);
bool TwoWire::begin(int sda, int scl, uint32_t) {
  sda_ = sda >= 0 ? sda : (bus_ == 0 ? SDA : 25);
  scl_ = scl >= 0 ? scl : (bus_ == 0 ? SCL : 26);
  started_ = hal_wire_begin(bus_, sda_, scl_) == 0;
  return started_;
}
bool TwoWire::setPins(int sda, int scl) {
  sda_ = sda, scl_ = scl;
  return true;
}
void TwoWire::beginTransmission(uint8_t addr) {
  if (!started_) begin(sda_, scl_);
  addr_ = addr;
  txLen_ = 0;
}
size_t TwoWire::write(uint8_t c) {
  if (txLen_ >= (int)sizeof txBuf_) return 0;
  txBuf_[txLen_++] = c;
  return 1;
}
size_t TwoWire::write(const uint8_t *buf, size_t n) {
  size_t k = 0;
  while (k < n && write(buf[k])) k++;
  return k;
}
uint8_t TwoWire::endTransmission(bool) {
  int r = hal_wire_xfer(bus_, addr_, txBuf_, txLen_, nullptr, 0);
  txLen_ = 0;
  return (uint8_t)r;
}
uint8_t TwoWire::requestFrom(uint8_t addr, uint8_t n, bool) {
  if (!started_) begin(sda_, scl_);
  if (n > sizeof rxBuf_) n = sizeof rxBuf_;
  rxPos_ = 0;
  rxLen_ = hal_wire_xfer(bus_, addr, nullptr, 0, rxBuf_, n) == 0 ? n : 0;
  return (uint8_t)rxLen_;
}

// ------------------------------------------------------------------ DHT
bool DHT::read(bool force) {
  unsigned long now = millis();
  if (have_ && !force && now - last_ < 2000) return ok_;  // the sensor is read at most every 2 s
  have_ = true;
  last_ = now;
  float t, h;
  ok_ = hal_dht_read(pin_, type_, &t, &h) == 0;
  if (ok_) t_ = t, h_ = h;
  else t_ = h_ = NAN;
  return ok_;
}
float DHT::readTemperature(bool f, bool force) {
  read(force);
  return f ? convertCtoF(t_) : t_;
}
float DHT::readHumidity(bool force) {
  read(force);
  return h_;
}
float DHT::computeHeatIndex(float t, float h, bool f) {
  float tf = f ? t : convertCtoF(t);
  float hi = 0.5f * (tf + 61.0f + ((tf - 68.0f) * 1.2f) + (h * 0.094f));
  if (hi > 79) {
    hi = -42.379f + 2.04901523f * tf + 10.14333127f * h - 0.22475541f * tf * h - 0.00683783f * tf * tf - 0.05481717f * h * h + 0.00122874f * tf * tf * h +
         0.00085282f * tf * h * h - 0.00000199f * tf * tf * h * h;
  }
  return f ? hi : (hi - 32) * 0.55555f;
}

// ------------------------------------------------------------------ DallasTemperature
void DallasTemperature::begin() { count_ = (uint8_t)hal_ow_scan(ow_->pin(), &roms_[0][0], 8); }
bool DallasTemperature::getAddress(uint8_t *addr, uint8_t i) {
  if (i >= count_) return false;
  memcpy(addr, roms_[i], 8);
  return true;
}
void DallasTemperature::requestTemperatures() {
  if (!count_) begin();
  if (wait_) delay(750);  // 12-bit conversion time
}
float DallasTemperature::getTempC(const uint8_t *addr) {
  float t;
  return hal_ow_temp(ow_->pin(), addr, &t) == 0 ? t : DEVICE_DISCONNECTED_C;
}
float DallasTemperature::getTempCByIndex(uint8_t i) {
  if (!count_) begin();
  return i < count_ ? getTempC(roms_[i]) : DEVICE_DISCONNECTED_C;
}

// ------------------------------------------------------------------ NeoPixel
Adafruit_NeoPixel::Adafruit_NeoPixel(uint16_t n, int16_t pin, uint16_t) : n_(n), pin_(pin) { rgb_ = (uint8_t *)calloc(n ? n * 3 : 3, 1); }
Adafruit_NeoPixel::~Adafruit_NeoPixel() { free(rgb_); }
void Adafruit_NeoPixel::setPixelColor(uint16_t i, uint8_t r, uint8_t g, uint8_t b) {
  if (i >= n_) return;
  rgb_[i * 3] = r, rgb_[i * 3 + 1] = g, rgb_[i * 3 + 2] = b;
}
void Adafruit_NeoPixel::setPixelColor(uint16_t i, uint32_t c) { setPixelColor(i, (uint8_t)(c >> 16), (uint8_t)(c >> 8), (uint8_t)c); }
void Adafruit_NeoPixel::fill(uint32_t c, uint16_t first, uint16_t count) {
  uint16_t end = count ? first + count : n_;
  for (uint16_t i = first; i < end && i < n_; i++) setPixelColor(i, c);
}
void Adafruit_NeoPixel::clear() { memset(rgb_, 0, n_ * 3); }
void Adafruit_NeoPixel::show() {
  if (bright_ == 255) {
    hal_neopixel_show(pin_, rgb_, n_);
    return;
  }
  uint8_t *tmp = (uint8_t *)malloc(n_ * 3);
  for (int i = 0; i < n_ * 3; i++) tmp[i] = (uint8_t)((rgb_[i] * (bright_ + 1)) >> 8);
  hal_neopixel_show(pin_, tmp, n_);
  free(tmp);
}

WiFiClass WiFi;

// ------------------------------------------------------------------ entry points for the host
extern "C" {
EXPORT(arduino_setup) void arduino_setup() { setup(); }
EXPORT(arduino_loop) void arduino_loop() { loop(); }
EXPORT(arduino_isr) void arduino_isr(int pin) {
  if (pin >= 0 && pin < 40 && isr[pin]) isr[pin]();
}
EXPORT(arduino_alloc) void *arduino_alloc(int n) { return malloc(n); }
}
