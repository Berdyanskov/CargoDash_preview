"""End-to-end runs through the threaded Executor via Pipeline.run()."""
import json
import tempfile
import unittest
from pathlib import Path

from cargodash import (
    Pipeline, RawDataSource, DataOutput, Processor, Judge,
    LLMCall, MockChatClient,
)


def _write_jsonl(path, rows):
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def _read_jsonl(path):
    with open(path, "r", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


class TestExecutorEndToEnd(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_linear_pipeline(self):
        src_path, out_path = self.dir / "in.jsonl", self.dir / "out.jsonl"
        _write_jsonl(src_path, [{"v": i} for i in range(5)])

        src = RawDataSource(str(src_path), batch_size=2)
        proc = Processor(lambda r: {"v": r["v"] * 10})
        src >> proc >> DataOutput(str(out_path))
        Pipeline(src).run()

        self.assertEqual(sorted(r["v"] for r in _read_jsonl(out_path)),
                         [0, 10, 20, 30, 40])

    def test_filter_pipeline_drops_rows(self):
        src_path, out_path = self.dir / "in.jsonl", self.dir / "out.jsonl"
        _write_jsonl(src_path, [{"v": i} for i in range(10)])

        src = RawDataSource(str(src_path), batch_size=4)
        keep_even = Processor(lambda r: r if r["v"] % 2 == 0 else None)
        src >> keep_even >> DataOutput(str(out_path))
        Pipeline(src).run()

        self.assertEqual(sorted(r["v"] for r in _read_jsonl(out_path)),
                         [0, 2, 4, 6, 8])

    def test_judge_branching_pipeline(self):
        src_path = self.dir / "in.jsonl"
        pos_path, neg_path = self.dir / "pos.jsonl", self.dir / "neg.jsonl"
        _write_jsonl(src_path, [{"v": v} for v in (-2, -1, 0, 1, 2)])

        src = RawDataSource(str(src_path), batch_size=2)
        judge = Judge(lambda r: r["v"] >= 0)
        src >> judge
        judge.on_true >> DataOutput(str(pos_path))
        judge.on_false >> DataOutput(str(neg_path))
        Pipeline(src).run()

        self.assertEqual(sorted(r["v"] for r in _read_jsonl(pos_path)), [0, 1, 2])
        self.assertEqual(sorted(r["v"] for r in _read_jsonl(neg_path)), [-2, -1])

    def test_convergence_pipeline_recombines_branches(self):
        src_path, out_path = self.dir / "in.jsonl", self.dir / "out.jsonl"
        _write_jsonl(src_path, [{"v": v} for v in (1, 2, 3, 4)])

        src = RawDataSource(str(src_path), batch_size=2)
        judge = Judge(lambda r: r["v"] % 2 == 0)
        even = Processor(lambda r: {"v": r["v"], "tag": "even"})
        odd = Processor(lambda r: {"v": r["v"], "tag": "odd"})
        sink = DataOutput(str(out_path))
        src >> judge
        judge.on_true >> even
        judge.on_false >> odd
        even >> sink
        odd >> sink
        Pipeline(src).run()

        tags = {r["v"]: r["tag"] for r in _read_jsonl(out_path)}
        self.assertEqual(tags, {1: "odd", 2: "even", 3: "odd", 4: "even"})

    def test_llm_call_pipeline_with_mock_client(self):
        src_path, out_path = self.dir / "in.jsonl", self.dir / "out.jsonl"
        _write_jsonl(src_path, [{"text": t} for t in ("a", "b", "c")])

        src = RawDataSource(str(src_path), batch_size=2)
        proc = Processor(LLMCall(
            prompt="upper: {text}",
            client=MockChatClient(
                response_fn=lambda msgs: msgs[-1]["content"].upper()),
        ))
        src >> proc >> DataOutput(str(out_path))
        Pipeline(src).run()

        self.assertEqual(
            sorted(r["llm_output"] for r in _read_jsonl(out_path)),
            ["UPPER: A", "UPPER: B", "UPPER: C"],
        )

    def test_multi_source_pipeline_merges_into_single_sink(self):
        src_a_path = self.dir / "a.jsonl"
        src_b_path = self.dir / "b.jsonl"
        out_path = self.dir / "out.jsonl"
        _write_jsonl(src_a_path, [{"v": v, "src": "a"} for v in (1, 2)])
        _write_jsonl(src_b_path, [{"v": v, "src": "b"} for v in (10, 20, 30)])

        src_a = RawDataSource(str(src_a_path), batch_size=2)
        src_b = RawDataSource(str(src_b_path), batch_size=2)
        sink = DataOutput(str(out_path))
        src_a >> sink
        src_b >> sink
        Pipeline([src_a, src_b]).run()

        rows = _read_jsonl(out_path)
        self.assertEqual(
            sorted((r["src"], r["v"]) for r in rows),
            [("a", 1), ("a", 2), ("b", 10), ("b", 20), ("b", 30)],
        )

    def test_error_in_processor_propagates_out_of_run(self):
        src_path, out_path = self.dir / "in.jsonl", self.dir / "out.jsonl"
        _write_jsonl(src_path, [{"v": i} for i in range(5)])

        def boom(row):
            raise RuntimeError("processor failed")

        src = RawDataSource(str(src_path), batch_size=2)
        src >> Processor(boom) >> DataOutput(str(out_path))
        with self.assertRaises(RuntimeError):
            Pipeline(src).run()


if __name__ == "__main__":
    unittest.main()
