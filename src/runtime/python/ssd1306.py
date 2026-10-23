"""MicroPython-style SSD1306 driver, adapted to run on the Pi with smbus2.

    from smbus2 import SMBus
    import ssd1306
    oled = ssd1306.SSD1306_I2C(128, 64, SMBus(1), addr=0x3C)
    oled.text('Hello', 0, 0); oled.show()
"""

import framebuf
from smbus2 import i2c_msg


class SSD1306(framebuf.FrameBuffer):
    def __init__(self, width, height, external_vcc=False):
        self.width = width
        self.height = height
        self.pages = height // 8
        self.buffer = bytearray(self.pages * width)
        super().__init__(self.buffer, width, height, framebuf.MONO_VLSB)
        self.init_display()

    def init_display(self):
        for cmd in (0xAE, 0x20, 0x00, 0x40, 0xA1, 0xA8, self.height - 1, 0xC8, 0xD3, 0x00, 0xDA, 0x12, 0xD5, 0x80, 0xD9, 0xF1,
                    0xDB, 0x30, 0x81, 0xFF, 0xA4, 0xA6, 0x8D, 0x14, 0xAF):
            self.write_cmd(cmd)
        self.fill(0)
        self.show()

    def poweroff(self):
        self.write_cmd(0xAE)

    def poweron(self):
        self.write_cmd(0xAF)

    def contrast(self, c):
        self.write_cmd(0x81)
        self.write_cmd(c)

    def invert(self, inv):
        self.write_cmd(0xA7 if inv else 0xA6)

    def show(self):
        for cmd in (0x21, 0, self.width - 1, 0x22, 0, self.pages - 1):
            self.write_cmd(cmd)
        self.write_data(self.buffer)


class SSD1306_I2C(SSD1306):
    def __init__(self, width, height, i2c, addr=0x3C, external_vcc=False):
        self.i2c = i2c
        self.addr = addr
        super().__init__(width, height, external_vcc)

    def write_cmd(self, cmd):
        self.i2c.i2c_rdwr(i2c_msg.write(self.addr, [0x80, cmd]))

    def write_data(self, buf):
        self.i2c.i2c_rdwr(i2c_msg.write(self.addr, [0x40] + list(buf)))
