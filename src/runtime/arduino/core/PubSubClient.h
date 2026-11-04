// PubSubClient (Nick O'Leary's MQTT client API) on the simulator's virtual MQTT broker.
#pragma once
#include "WiFi.h"

#define MQTT_CONNECTION_TIMEOUT -4
#define MQTT_CONNECTION_LOST -3
#define MQTT_CONNECT_FAILED -2
#define MQTT_DISCONNECTED -1
#define MQTT_CONNECTED 0
#define MQTT_MAX_PACKET_SIZE 256

typedef void (*MQTT_CALLBACK_SIGNATURE)(char *topic, uint8_t *payload, unsigned int length);

class PubSubClient {
 public:
  PubSubClient() {}
  explicit PubSubClient(WiFiClient &) {}
  PubSubClient &setClient(WiFiClient &) { return *this; }
  PubSubClient &setServer(const char *host, uint16_t port) {
    strncpy(host_, host, sizeof host_ - 1);
    port_ = port;
    return *this;
  }
  PubSubClient &setCallback(MQTT_CALLBACK_SIGNATURE cb) {
    cb_ = cb;
    return *this;
  }
  PubSubClient &setBufferSize(uint16_t) { return *this; }
  PubSubClient &setKeepAlive(uint16_t) { return *this; }
  bool connect(const char *id) { return connect(id, nullptr, nullptr); }
  bool connect(const char *id, const char *user, const char *pass) {
    bool ok = hal_mqtt_connect(host_, port_, id, user ? user : "", pass ? pass : "") == 1;
    state_ = ok ? MQTT_CONNECTED : MQTT_CONNECT_FAILED;
    return ok;
  }
  void disconnect() {
    hal_mqtt_disconnect();
    state_ = MQTT_DISCONNECTED;
  }
  bool connected() {
    bool c = hal_mqtt_connected() == 1;
    if (!c && state_ == MQTT_CONNECTED) state_ = MQTT_CONNECTION_LOST;
    return c;
  }
  int state() { return state_; }
  bool publish(const char *topic, const char *payload, bool retained = false) { return hal_mqtt_publish(topic, (const uint8_t *)payload, (int)strlen(payload), retained) == 1; }
  bool publish(const char *topic, const uint8_t *payload, unsigned int len, bool retained = false) { return hal_mqtt_publish(topic, payload, (int)len, retained) == 1; }
  bool subscribe(const char *topic, uint8_t qos = 0) { return hal_mqtt_subscribe(topic) == 1; }
  bool unsubscribe(const char *topic) { return hal_mqtt_unsubscribe(topic) == 1; }
  /** delivers queued messages to the callback; call it often from loop() */
  bool loop() {
    if (!connected()) return false;
    for (int i = 0; i < 20; i++) {
      int n = hal_mqtt_next(topic_, sizeof topic_, payload_, sizeof payload_ - 1);
      if (n < 0) break;
      payload_[n] = 0;
      if (cb_) cb_(topic_, payload_, (unsigned)n);
    }
    return true;
  }

 private:
  char host_[64] = "";
  uint16_t port_ = 1883;
  MQTT_CALLBACK_SIGNATURE cb_ = nullptr;
  int state_ = MQTT_DISCONNECTED;
  char topic_[128];
  uint8_t payload_[MQTT_MAX_PACKET_SIZE + 1];
};
