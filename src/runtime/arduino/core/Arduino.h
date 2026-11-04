// Arduino core for the simulated ESP32-DevKitC (subset of the Arduino-ESP32 3.x API).
// The sketch is compiled by Clang to WebAssembly; hardware calls go to the simulator.
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdarg.h>
#include "hal.h"

typedef bool boolean;
typedef uint8_t byte;
typedef uint16_t word;

#define HIGH 0x1
#define LOW 0x0
#define INPUT 0x01
#define OUTPUT 0x03
#define PULLUP 0x04
#define INPUT_PULLUP 0x05
#define PULLDOWN 0x08
#define INPUT_PULLDOWN 0x09
#define OPEN_DRAIN 0x10
#define OUTPUT_OPEN_DRAIN 0x13
#define ANALOG 0xC0

#define RISING 0x01
#define FALLING 0x02
#define CHANGE 0x03
#define ONLOW 0x04
#define ONHIGH 0x05

#define LED_BUILTIN 2
#define A0 36
#define A3 39
#define A4 32
#define A5 33
#define A6 34
#define A7 35
#define A10 4
#define A11 0
#define A12 2
#define A13 15
#define A14 13
#define A15 12
#define A16 14
#define A17 27
#define A18 25
#define A19 26
#define DAC1 25
#define DAC2 26
#define SDA 21
#define SCL 22
#define TX 1
#define RX 3

#define PI 3.1415926535897932384626433832795
#define HALF_PI 1.5707963267948966192313216916398
#define TWO_PI 6.283185307179586476925286766559
#define DEG_TO_RAD 0.017453292519943295769236907684886
#define RAD_TO_DEG 57.295779513082320876798154814105
#define EULER 2.718281828459045235360287471352

#define SERIAL_8N1 0x800001c
#define DEC 10
#define HEX 16
#define OCT 8
#define BIN 2

#define NAN __builtin_nanf("")
#define INFINITY __builtin_inff()
#define isnan(x) __builtin_isnan(x)
#define isinf(x) __builtin_isinf(x)

#define min(a, b) ((a) < (b) ? (a) : (b))
#define max(a, b) ((a) > (b) ? (a) : (b))
#define constrain(amt, low, high) ((amt) < (low) ? (low) : ((amt) > (high) ? (high) : (amt)))
#define sq(x) ((x) * (x))
#define radians(deg) ((deg) * DEG_TO_RAD)
#define degrees(rad) ((rad) * RAD_TO_DEG)
#define bitRead(value, bit) (((value) >> (bit)) & 0x01)
#define bitSet(value, bit) ((value) |= (1UL << (bit)))
#define bitClear(value, bit) ((value) &= ~(1UL << (bit)))
#define bitWrite(value, bit, bitvalue) ((bitvalue) ? bitSet(value, bit) : bitClear(value, bit))
#define bit(b) (1UL << (b))
#define lowByte(w) ((uint8_t)((w) & 0xff))
#define highByte(w) ((uint8_t)((w) >> 8))
#define digitalPinToInterrupt(p) (p)
#define IRAM_ATTR
#define F(s) (s)
#define PROGMEM

typedef enum { ADC_0db, ADC_2_5db, ADC_6db, ADC_11db } adc_attenuation_t;

// ---- math (libm functions provided by the host)
extern "C" {
double sin(double);
double cos(double);
double tan(double);
double asin(double);
double acos(double);
double atan(double);
double atan2(double, double);
double exp(double);
double log(double);
double log10(double);
double pow(double, double);
double fmod(double, double);
double floor(double);
double ceil(double);
double round(double);
double sqrt(double);
double fabs(double);
float sinf(float);
float cosf(float);
float powf(float, float);
float sqrtf(float);
float fabsf(float);
float roundf(float);
float floorf(float);
float ceilf(float);
float logf(float);
float expf(float);
void *malloc(size_t);
void free(void *);
void *calloc(size_t, size_t);
void *realloc(void *, size_t);
void *memcpy(void *, const void *, size_t);
void *memmove(void *, const void *, size_t);
void *memset(void *, int, size_t);
int memcmp(const void *, const void *, size_t);
size_t strlen(const char *);
int strcmp(const char *, const char *);
int strncmp(const char *, const char *, size_t);
char *strcpy(char *, const char *);
char *strncpy(char *, const char *, size_t);
char *strcat(char *, const char *);
const char *strchr(const char *, int);
const char *strstr(const char *, const char *);
int atoi(const char *);
long atol(const char *);
double atof(const char *);
long strtol(const char *, char **, int);
double strtod(const char *, char **);
int abs(int);
long labs(long);
int vsnprintf(char *, size_t, const char *, va_list);
int snprintf(char *, size_t, const char *, ...);
int sprintf(char *, const char *, ...);
char *itoa(int, char *, int);
char *ltoa(long, char *, int);
char *utoa(unsigned, char *, int);
char *dtostrf(double, signed char, unsigned char, char *);
}
inline float abs(float x) { return x < 0 ? -x : x; }
inline double abs(double x) { return x < 0 ? -x : x; }
inline long abs(long x) { return x < 0 ? -x : x; }

// ---- digital / analog I/O
void pinMode(uint8_t pin, uint8_t mode);
void digitalWrite(uint8_t pin, uint8_t val);
int digitalRead(uint8_t pin);
uint16_t analogRead(uint8_t pin);
uint32_t analogReadMilliVolts(uint8_t pin);
void analogReadResolution(uint8_t bits);
void analogSetAttenuation(adc_attenuation_t a);
void analogSetPinAttenuation(uint8_t pin, adc_attenuation_t a);
void analogWrite(uint8_t pin, int value);
void analogWriteFrequency(uint8_t pin, uint32_t freq);
void analogWriteResolution(uint8_t pin, uint8_t bits);
void dacWrite(uint8_t pin, uint8_t value);
// LEDC (Arduino-ESP32 3.x pin-based API)
bool ledcAttach(uint8_t pin, uint32_t freq, uint8_t resolution);
bool ledcAttachChannel(uint8_t pin, uint32_t freq, uint8_t resolution, int8_t channel);
bool ledcWrite(uint8_t pin, uint32_t duty);
uint32_t ledcRead(uint8_t pin);
uint32_t ledcWriteTone(uint8_t pin, uint32_t freq);
bool ledcDetach(uint8_t pin);
// LEDC (Arduino-ESP32 2.x channel-based API)
uint32_t ledcSetup(uint8_t channel, uint32_t freq, uint8_t resolution);
void ledcAttachPin(uint8_t pin, uint8_t channel);
void ledcDetachPin(uint8_t pin);
void tone(uint8_t pin, unsigned int frequency, unsigned long duration = 0);
void noTone(uint8_t pin);
unsigned long pulseIn(uint8_t pin, uint8_t state, unsigned long timeout = 1000000L);

typedef void (*voidFuncPtr)(void);
void attachInterrupt(uint8_t pin, voidFuncPtr handler, int mode);
void detachInterrupt(uint8_t pin);
void interrupts();
void noInterrupts();

// ---- time
void delay(uint32_t ms);
void delayMicroseconds(uint32_t us);
unsigned long millis();
unsigned long micros();
void yield();

// ---- random
long random(long max);
long random(long min, long max);
void randomSeed(unsigned long seed);
uint32_t esp_random();
long map(long x, long in_min, long in_max, long out_min, long out_max);

#include "WString.h"
#include "Print.h"
#include "HardwareSerial.h"

class EspClass {
 public:
  void restart();
  uint32_t getFreeHeap();
  uint32_t getCpuFreqMHz() { return 240; }
  const char *getChipModel() { return "ESP32-D0WD-V3"; }
  uint64_t getEfuseMac();
};
extern EspClass ESP;

void setup();
void loop();
