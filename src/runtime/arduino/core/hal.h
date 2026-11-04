// Simulator HAL: functions the JavaScript host provides to the compiled sketch.
#pragma once
#include <stdint.h>
#include <stddef.h>

#define HAL(name) __attribute__((import_module("arduino"), import_name(#name)))

extern "C" {
HAL(pin_mode) void hal_pin_mode(int pin, int mode);
HAL(digital_write) void hal_digital_write(int pin, int val);
HAL(digital_read) int hal_digital_read(int pin);
HAL(analog_read) int hal_analog_read(int pin, int bits, int atten);
HAL(analog_read_mv) int hal_analog_read_mv(int pin, int atten);
HAL(pwm_set) void hal_pwm_set(int pin, double freq, double duty);
HAL(pwm_stop) void hal_pwm_stop(int pin);
HAL(dac_write) void hal_dac_write(int pin, int value);
HAL(delay_ms) void hal_delay_ms(double ms);
HAL(millis) double hal_millis(void);
HAL(micros) double hal_micros(void);
HAL(serial_begin) void hal_serial_begin(int port, int baud, int rx, int tx);
HAL(serial_end) void hal_serial_end(int port);
HAL(serial_write) void hal_serial_write(int port, const uint8_t *buf, int len);
HAL(serial_available) int hal_serial_available(int port);
HAL(serial_read) int hal_serial_read(int port);
HAL(wire_begin) int hal_wire_begin(int bus, int sda, int scl);
HAL(wire_xfer) int hal_wire_xfer(int bus, int addr, const uint8_t *w, int wlen, uint8_t *r, int rlen);
HAL(dht_read) int hal_dht_read(int pin, int type, float *t, float *h);
HAL(ow_scan) int hal_ow_scan(int pin, uint8_t *roms, int max);
HAL(ow_temp) int hal_ow_temp(int pin, const uint8_t *rom, float *t);
HAL(neopixel_show) void hal_neopixel_show(int pin, const uint8_t *rgb, int n);
HAL(attach_interrupt) void hal_attach_interrupt(int pin, int mode);
HAL(detach_interrupt) void hal_detach_interrupt(int pin);
HAL(random_u32) uint32_t hal_random_u32(void);
HAL(restart) void hal_restart(void);
HAL(wifi_begin) int hal_wifi_begin(const char *ssid, const char *pass);
HAL(wifi_status) int hal_wifi_status(void);
HAL(wifi_disconnect) void hal_wifi_disconnect(void);
HAL(wifi_ip) int hal_wifi_ip(char *buf, int max);
HAL(wifi_rssi) int hal_wifi_rssi(void);
HAL(mqtt_connect) int hal_mqtt_connect(const char *host, int port, const char *client, const char *user, const char *pass);
HAL(mqtt_connected) int hal_mqtt_connected(void);
HAL(mqtt_disconnect) void hal_mqtt_disconnect(void);
HAL(mqtt_publish) int hal_mqtt_publish(const char *topic, const uint8_t *payload, int len, int retain);
HAL(mqtt_subscribe) int hal_mqtt_subscribe(const char *topic);
HAL(mqtt_unsubscribe) int hal_mqtt_unsubscribe(const char *topic);
/** next pending MQTT message for this board: topic and payload copied, returns payload length or -1 */
HAL(mqtt_next) int hal_mqtt_next(char *topic, int tmax, uint8_t *payload, int pmax);
HAL(mqtt_state) int hal_mqtt_state(void);
}
