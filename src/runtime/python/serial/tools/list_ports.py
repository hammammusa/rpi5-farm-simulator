class ListPortInfo:
    def __init__(self, device, description):
        self.device = device
        self.name = device.split('/')[-1]
        self.description = description
        self.hwid = 'n/a'

    def __iter__(self):
        return iter((self.device, self.description, self.hwid))

    def __repr__(self):
        return '%s - %s' % (self.device, self.description)


def comports(include_links=False):
    return [ListPortInfo('/dev/ttyAMA0', 'UART0 (GPIO14/15)')] + ([ListPortInfo('/dev/serial0', 'link to ttyAMA0')] if include_links else [])
