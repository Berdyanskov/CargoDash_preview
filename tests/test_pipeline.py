"""Pipeline: DAG node collection and construction-time schema validation."""
import unittest

from cargodash import Pipeline, Module, Processor, Judge, Schema


def _passthrough(row):
    return row


class TestPipelineNodeCollection(unittest.TestCase):
    def test_linear_chain(self):
        a, b, c = Module(name="a"), Module(name="b"), Module(name="c")
        a >> b >> c
        self.assertEqual(set(Pipeline(a).nodes), {a, b, c})

    def test_diamond_collects_each_node_once(self):
        src = Module(name="src")
        left, right = Module(name="left"), Module(name="right")
        sink = Module(name="sink")
        src >> left
        src >> right
        left >> sink
        right >> sink
        nodes = Pipeline(src).nodes
        self.assertEqual(len(nodes), 4)
        self.assertEqual(nodes.count(sink), 1)

    def test_branching_graph_through_judge(self):
        src = Module(name="src")
        j = Judge(lambda r: True, name="j")
        t, f = Module(name="t"), Module(name="f")
        src >> j
        j.on_true >> t
        j.on_false >> f
        self.assertEqual(set(Pipeline(src).nodes), {src, j, t, f})


class TestPipelineSchemaValidation(unittest.TestCase):
    def test_compatible_edge_schemas_pass(self):
        s = Schema.of(text=str)
        a = Processor(_passthrough, output_schema=s, name="a")
        b = Processor(_passthrough, input_schema=s, name="b")
        a >> b
        Pipeline(a)  # must not raise

    def test_mismatched_edge_schema_raises(self):
        a = Processor(_passthrough, output_schema=Schema.of(text=str), name="a")
        b = Processor(_passthrough, input_schema=Schema.of(score=int), name="b")
        a >> b
        with self.assertRaises(TypeError):
            Pipeline(a)

    def test_undeclared_schema_skips_the_check(self):
        # When either side leaves its schema unset, no validation happens.
        a = Processor(_passthrough, output_schema=Schema.of(text=str), name="a")
        b = Processor(_passthrough, name="b")  # input_schema is None
        a >> b
        Pipeline(a)  # must not raise

    def test_convergence_with_matching_schemas_passes(self):
        s = Schema.of(text=str)
        src = Module(name="src")
        u1 = Processor(_passthrough, output_schema=s, name="u1")
        u2 = Processor(_passthrough, output_schema=s, name="u2")
        sink = Module(name="sink")
        src >> u1
        src >> u2
        u1 >> sink
        u2 >> sink
        Pipeline(src)  # must not raise

    def test_multi_source_collects_all_reachable_nodes(self):
        src_a, src_b = Module(name="src_a"), Module(name="src_b")
        sink = Module(name="sink")
        src_a >> sink
        src_b >> sink
        pipeline = Pipeline([src_a, src_b])
        self.assertEqual(set(pipeline.nodes), {src_a, src_b, sink})
        self.assertEqual(pipeline.sources, [src_a, src_b])

    def test_empty_source_list_raises(self):
        with self.assertRaises(ValueError):
            Pipeline([])

    def test_non_module_source_raises(self):
        with self.assertRaises(TypeError):
            Pipeline(["not a module"])  # type: ignore[list-item]

    def test_convergence_with_mismatched_schemas_raises(self):
        src = Module(name="src")
        u1 = Processor(_passthrough, output_schema=Schema.of(text=str), name="u1")
        u2 = Processor(_passthrough, output_schema=Schema.of(score=int), name="u2")
        sink = Module(name="sink")
        src >> u1
        src >> u2
        u1 >> sink
        u2 >> sink
        with self.assertRaises(TypeError):
            Pipeline(src)


if __name__ == "__main__":
    unittest.main()
