


class EfficientQueue:
    def __init__(self, capacity = 16):
        self.capacity = capacity
        self.data = [None] * capacity
        self.head = 0   # 队头指针
        self.tail = 0   # 队尾指针
        self.size = 0

    def _resize(self, new_capacity):
        new_data = [None] * new_capacity

        for i in range(self.size):
            new_data[i] = self.data[(self.head + i) % self.capacity]

        self.data = new_data
        self.capacity = new_capacity
        self.head = 0
        self.tail = self.size

    def enqueue(self, x):
        if self.size == self.capacity:
            self._resize(self.capacity * 2)

        self.data[self.tail] = x
        self.tail = (self.tail + 1) % self.capacity
        self.size += 1

    def dequeue(self):
        if self.size == 0:
            raise IndexError("dequeue from empty queue")

        x = self.data[self.head]
        self.data[self.head] = None  # 释放引用，避免内存滞留
        self.head = (self.head + 1) % self.capacity
        self.size -= 1
        return x

    def peek(self):
        if self.size == 0:
            raise IndexError("peek from empty queue")
        return self.data[self.head]

    def __len__(self):
        return self.size

    def __repr__(self):
        items = [self.data[(self.head + i) % self.capacity] for i in range(self.size)]
        return f"EfficientQueue({items})"