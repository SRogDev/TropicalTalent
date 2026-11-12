"""Shared fakes for Phase 3 service tests.

A minimal in-memory stand-in for the Supabase query builder chain
(table().select().eq()...execute()) so sourcing/offer tests never touch
a real database. Only the builder methods the Phase 3 services use are
implemented; anything else raises loudly instead of silently passing.
"""

from __future__ import annotations


class _Result:
    def __init__(self, data):
        self.data = data


class FakeQuery:
    """Chainable fake: records filters, applies them to stored rows."""

    def __init__(self, store, table, rows=None):
        self._store = store
        self._table = table
        self._rows = list(rows) if rows is not None else list(store.get(table, []))
        self._filters = []
        self._insert_rows = None
        self._update_values = None
        self._limit = None
        self._select_cols = "*"

    # -- builder ---------------------------------------------------------
    def select(self, cols="*"):
        self._select_cols = cols
        return self

    def insert(self, rows):
        self._insert_rows = rows if isinstance(rows, list) else [rows]
        return self

    def update(self, values):
        self._update_values = values
        return self

    def eq(self, col, value):
        self._filters.append(("eq", col, value))
        return self

    def gte(self, col, value):
        self._filters.append(("gte", col, value))
        return self

    def lte(self, col, value):
        self._filters.append(("lte", col, value))
        return self

    def is_(self, col, value):
        self._filters.append(("is", col, value))
        return self

    def in_(self, col, values):
        self._filters.append(("in", col, list(values)))
        return self

    def overlaps(self, col, values):
        self._filters.append(("overlaps", col, list(values)))
        return self

    def ilike(self, col, pattern):
        self._filters.append(("ilike", col, pattern))
        return self

    def order(self, col, desc=False):
        return self

    def limit(self, n):
        self._limit = n
        return self

    def range(self, _a, _b):
        return self

    def single(self):
        return self

    # -- execution -------------------------------------------------------
    def execute(self):
        if self._insert_rows is not None:
            inserted = []
            for row in self._insert_rows:
                stored = dict(row)
                stored.setdefault("id", f"fake-{len(self._store.get(self._table, [])) + 1}")
                self._store.setdefault(self._table, []).append(stored)
                inserted.append(stored)
            return _Result(inserted)
        if self._update_values is not None:
            updated = []
            for row in self._apply_filters(self._rows):
                row.update(self._update_values)
                updated.append(row)
            return _Result(updated)
        rows = self._apply_filters(self._rows)
        if self._limit is not None:
            rows = rows[: self._limit]
        return _Result(rows)

    def _apply_filters(self, rows):
        out = list(rows)
        for kind, col, value in self._filters:
            if kind == "eq":
                out = [r for r in out if r.get(col) == value]
            elif kind == "is":
                if value == "null":
                    out = [r for r in out if r.get(col) is None]
                else:
                    out = [r for r in out if r.get(col) == value]
            elif kind == "in":
                out = [r for r in out if r.get(col) in value]
            elif kind == "gte":
                out = [r for r in out if str(r.get(col) or "") >= str(value)]
            elif kind == "lte":
                out = [r for r in out if str(r.get(col) or "") <= str(value)]
            elif kind == "overlaps":
                out = [
                    r
                    for r in out
                    if set(r.get(col) or []) & set(value)
                ]
            elif kind == "ilike":
                needle = str(value).strip("%").lower()
                out = [r for r in out if needle in str(r.get(col) or "").lower()]
        return out


class FakeSupabase:
    """Fake Supabase client wrapper: `.table(name)` returns FakeQuery.

    Phase 3 services access the raw client as `supabase._client`, mirroring
    `app.services.agent_service` (which awaits `get_supabase_client()` and
    then uses `._client.table(...)`).
    """

    def __init__(self, store=None):
        self.store = store if store is not None else {}
        self._client = self

    def table(self, name):
        return FakeQuery(self.store, name)
