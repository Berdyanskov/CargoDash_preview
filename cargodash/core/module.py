import json
from ..data_utils.queue import EfficientQueue
class Module:
    def __init__(self):
        self.downstreams = [] # 一个节点支持多个下游节点
        self.upstreams = [] # 同样也有多个上游节点
        # 这两个列表存指针-队列二元组，或者说在python里面是
        
    def __rshift__(self, other: Module): # >> 重载，相当于建立一条边
        self.downstreams.append({"node": other, "queue": EfficientQueue()})
        other.upstreams.append({"node": other}) # 上游不提供队列，因为逻辑上下游不会对上游产生
        