from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from .auth_models import Role, User

PASSWORD_MIN_LENGTH = 8


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class PermissionOut(BaseModel):
    code: str
    description: str

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=PASSWORD_MIN_LENGTH)
    full_name: str = ""
    role_id: str


class UserUpdate(BaseModel):
    """Tous les champs sont optionnels. `password` permet à un administrateur de
    réinitialiser un mot de passe (révoque les sessions de l'utilisateur)."""
    full_name: str | None = None
    role_id: str | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=PASSWORD_MIN_LENGTH)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=PASSWORD_MIN_LENGTH)


class UserOut(BaseModel):
    id: str
    email: str
    full_name: str
    is_active: bool
    role_id: str
    role: str
    permissions: list[str]
    created_at: datetime
    last_login_at: datetime | None

    @classmethod
    def from_user(cls, user: User) -> "UserOut":
        return cls(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            is_active=user.is_active,
            role_id=user.role_id,
            role=user.role.name,
            permissions=user.permission_codes,
            created_at=user.created_at,
            last_login_at=user.last_login_at,
        )


class RoleCreate(BaseModel):
    name: str = Field(min_length=2, max_length=50)
    description: str = ""
    permissions: list[str] = []


class RoleUpdate(BaseModel):
    """`permissions`, s'il est fourni, REMPLACE l'ensemble des permissions."""
    name: str | None = Field(default=None, min_length=2, max_length=50)
    description: str | None = None
    permissions: list[str] | None = None


class RoleOut(BaseModel):
    id: str
    name: str
    description: str
    is_system: bool
    permissions: list[str]
    user_count: int
    created_at: datetime

    @classmethod
    def from_role(cls, role: Role) -> "RoleOut":
        return cls(
            id=role.id,
            name=role.name,
            description=role.description,
            is_system=role.is_system,
            permissions=role.permission_codes,
            user_count=len(role.users),
            created_at=role.created_at,
        )
