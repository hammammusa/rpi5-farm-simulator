// Arduino String (heap-allocated, subset of the official API)
#pragma once
#include <stdint.h>
#include <stddef.h>

class String {
 public:
  String(const char *s = "");
  String(const String &s);
  String(String &&s);
  String(char c);
  String(int v, unsigned char base = 10);
  String(unsigned int v, unsigned char base = 10);
  String(long v, unsigned char base = 10);
  String(unsigned long v, unsigned char base = 10);
  String(float v, unsigned char decimals = 2);
  String(double v, unsigned char decimals = 2);
  ~String();
  String &operator=(const String &s);
  String &operator=(String &&s);
  String &operator=(const char *s);
  String &operator+=(const String &s) { return concat(s); }
  String &operator+=(const char *s) { return concat(s); }
  String &operator+=(char c) { return concat(c); }
  String &operator+=(int v) { return concat(String(v)); }
  String &operator+=(unsigned int v) { return concat(String(v)); }
  String &operator+=(long v) { return concat(String(v)); }
  String &operator+=(unsigned long v) { return concat(String(v)); }
  String &operator+=(float v) { return concat(String(v)); }
  String &operator+=(double v) { return concat(String(v)); }
  String &concat(const String &s);
  String &concat(const char *s);
  String &concat(char c);
  unsigned int length() const { return len_; }
  const char *c_str() const { return buf_ ? buf_ : ""; }
  char charAt(unsigned int i) const { return i < len_ ? buf_[i] : 0; }
  char operator[](unsigned int i) const { return charAt(i); }
  void setCharAt(unsigned int i, char c) {
    if (i < len_) buf_[i] = c;
  }
  bool equals(const String &s) const;
  bool equals(const char *s) const;
  bool equalsIgnoreCase(const String &s) const;
  bool operator==(const String &s) const { return equals(s); }
  bool operator==(const char *s) const { return equals(s); }
  bool operator!=(const String &s) const { return !equals(s); }
  bool operator!=(const char *s) const { return !equals(s); }
  bool operator<(const String &s) const { return compareTo(s) < 0; }
  int compareTo(const String &s) const;
  bool startsWith(const String &s) const;
  bool endsWith(const String &s) const;
  int indexOf(char c, unsigned int from = 0) const;
  int indexOf(const String &s, unsigned int from = 0) const;
  int lastIndexOf(char c) const;
  String substring(unsigned int from) const { return substring(from, len_); }
  String substring(unsigned int from, unsigned int to) const;
  void replace(const String &find, const String &repl);
  void remove(unsigned int index, unsigned int count = (unsigned int)-1);
  void toUpperCase();
  void toLowerCase();
  void trim();
  long toInt() const;
  float toFloat() const;
  double toDouble() const;
  bool isEmpty() const { return len_ == 0; }
  bool reserve(unsigned int n);
  explicit operator bool() const { return true; }

 private:
  char *buf_ = nullptr;
  unsigned int len_ = 0;
  unsigned int cap_ = 0;
  void set(const char *s, unsigned int n);
};

String operator+(const String &a, const String &b);
String operator+(const String &a, const char *b);
String operator+(const char *a, const String &b);
String operator+(const String &a, char b);
String operator+(const String &a, int b);
String operator+(const String &a, unsigned int b);
String operator+(const String &a, long b);
String operator+(const String &a, unsigned long b);
String operator+(const String &a, float b);
String operator+(const String &a, double b);
