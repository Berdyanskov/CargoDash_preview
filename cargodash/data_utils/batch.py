class Batch:
    def __init__(self):
        self.size = 0
        self.data = []
    def __init__(self, other: Batch):
        self.size = other.size
        self.data = other.data