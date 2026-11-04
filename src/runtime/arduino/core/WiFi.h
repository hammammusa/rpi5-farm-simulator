// WiFi (station mode) on the simulator's virtual network: joins the access point of a
// Wiren Board in the project. The radio and TCP/IP stack are not simulated.
#pragma once
#include "Arduino.h"

typedef enum { WL_IDLE_STATUS = 0, WL_NO_SSID_AVAIL = 1, WL_SCAN_COMPLETED = 2, WL_CONNECTED = 3, WL_CONNECT_FAILED = 4, WL_CONNECTION_LOST = 5, WL_DISCONNECTED = 6 } wl_status_t;
#define WIFI_STA 1

class IPAddress {
 public:
  IPAddress() {}
  explicit IPAddress(const char *s) { strncpy(buf_, s, sizeof buf_ - 1); }
  String toString() const { return String(buf_); }
  operator String() const { return toString(); }
  const char *c_str() const { return buf_; }

 private:
  char buf_[20] = "0.0.0.0";
};
inline size_t operator<<(Print &p, const IPAddress &ip) { return p.print(ip.c_str()); }

class WiFiClass {
 public:
  void mode(int) {}
  wl_status_t begin(const char *ssid, const char *pass = "") {
    hal_wifi_begin(ssid, pass ? pass : "");
    return status();
  }
  wl_status_t status() { return (wl_status_t)hal_wifi_status(); }
  bool isConnected() { return status() == WL_CONNECTED; }
  bool disconnect(bool = false) {
    hal_wifi_disconnect();
    return true;
  }
  void setAutoReconnect(bool) {}
  void setHostname(const char *) {}
  IPAddress localIP() {
    char b[20];
    hal_wifi_ip(b, sizeof b);
    return IPAddress(b);
  }
  int32_t RSSI() { return hal_wifi_rssi(); }
  String macAddress() { return String("24:0A:C4:00:00:01"); }
};
extern WiFiClass WiFi;

/** placeholder for the TCP client PubSubClient is built on (MQTT is handled by the simulator) */
class WiFiClient {};
