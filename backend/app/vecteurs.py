"""Colonne de vecteurs sémantiques (sprint 9, assistant documentaire).

Sur PostgreSQL, la colonne est un `vector(n)` de l'extension pgvector : la
recherche par similarité se fait dans la base, avec un index HNSW. Sur SQLite
(tests), le même vecteur est rangé en JSON et la similarité se calcule en
Python : le code appelant ne voit qu'une liste de flottants dans les deux cas.

La dimension est fixée par le modèle de vectorisation (bge-m3 : 1024). En
changer impose une migration, puisque l'index HNSW exige une dimension fixe ;
les passages gardent de toute façon le nom du modèle qui les a vectorisés.
"""
from sqlalchemy import JSON
from sqlalchemy.types import TypeDecorator, UserDefinedType

DIMENSION = 1024


class _VectorPg(UserDefinedType):
    """Type `vector(n)` de pgvector, échangé sous sa forme texte « [x,y,…] »."""
    cache_ok = True

    def __init__(self, dimension: int):
        self.dimension = dimension

    def get_col_spec(self, **kw) -> str:
        return f"vector({self.dimension})"

    def bind_processor(self, dialect):
        def traiter(valeur):
            if valeur is None:
                return None
            return "[" + ",".join(repr(float(x)) for x in valeur) + "]"
        return traiter

    def result_processor(self, dialect, coltype):
        def traiter(valeur):
            if valeur is None:
                return None
            if isinstance(valeur, (list, tuple)):
                return [float(x) for x in valeur]
            corps = str(valeur).strip().strip("[]")
            return [float(x) for x in corps.split(",")] if corps else []
        return traiter


class Vecteur(TypeDecorator):
    """Vecteur de flottants de dimension fixe : pgvector, ou JSON sous SQLite."""
    # none_as_null : un vecteur absent est un vrai NULL SQL, pas le JSON `null`.
    impl = JSON(none_as_null=True)
    cache_ok = True

    def __init__(self, dimension: int = DIMENSION):
        super().__init__()
        self.dimension = dimension

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(_VectorPg(self.dimension))
        return dialect.type_descriptor(JSON(none_as_null=True))

    def process_bind_param(self, valeur, dialect):
        if valeur is None:
            return None
        v = [float(x) for x in valeur]
        if len(v) != self.dimension:
            raise ValueError(f"Vecteur de dimension {len(v)}, {self.dimension} attendue.")
        if any(x != x or x in (float("inf"), float("-inf")) for x in v):
            raise ValueError("Vecteur non fini.")
        return v

    def process_result_value(self, valeur, dialect):
        return None if valeur is None else [float(x) for x in valeur]
