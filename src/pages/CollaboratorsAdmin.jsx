import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { getActiveDepartments } from "../services/departmentsService";
import {
  createUserByAdmin,
  deactivateUserProfile,
  getAllUsers,
  restoreUserProfile,
  sendUserPasswordReset,
  softDeleteUserProfile,
  updateUserProfile,
} from "../services/usersService";

const AREA_OPTIONS = [
  "Dirección",
  "Administración",
  "Recepción",
  "Dirección Académica",
  "Producción Audiovisual",
  "Desarrollo de Software",
  "Desarrollo de Material",
  "Soporte Técnico",
  "Imprenta",
  "Soporte Técnico / Imprenta",
  "Redes Sociales",
  "Coffee Beans Factory",
];

const PRIVILEGE_OPTIONS = [
  {
    value: "admin",
    label: "Administrador",
    description: "Acceso total al sistema.",
  },
  {
    value: "collaborator",
    label: "Colaborador",
    description: "Puede trabajar en proyectos asignados.",
  },
  {
    value: "requester",
    label: "Solicitante",
    description: "Puede consultar proyectos relacionados con su área.",
  },
];

const STATUS_OPTIONS = [
  {
    value: "active",
    label: "Activo",
  },
  {
    value: "inactive",
    label: "Inactivo",
  },
];

const EMPTY_NEW_USER = {
  name: "",
  email: "",
  area: "",
  role: "collaborator",
  notes: "",
  departmentIds: [],
};

export default function CollaboratorsAdmin() {
  const { profile, refreshProfile } = useAuth();

  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);

  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedUserDraft, setSelectedUserDraft] = useState(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [createdTemporaryPassword, setCreatedTemporaryPassword] = useState("");
  const [newUserDraft, setNewUserDraft] = useState(EMPTY_NEW_USER);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [areaFilter, setAreaFilter] = useState("all");
  const [privilegeFilter, setPrivilegeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const selectedUser = useMemo(() => {
    return users.find((user) => user.id === selectedUserId) || null;
  }, [users, selectedUserId]);

  const nonDeletedUsers = useMemo(() => {
    return users.filter((user) => user.deleted !== true);
  }, [users]);

  const deletedUsers = useMemo(() => {
    return users.filter((user) => user.deleted === true);
  }, [users]);

  const footerTotalUsers =
    statusFilter === "deleted" ? deletedUsers.length : nonDeletedUsers.length;

  const footerUserLabel =
    statusFilter === "deleted" ? "usuarios eliminados" : "usuarios";

  const stats = useMemo(() => {
    const total = users.filter((user) => user.deleted !== true).length;
    const active = users.filter(
      (user) => user.active === true && user.deleted !== true
    ).length;
    const admins = users.filter(
      (user) => user.role === "admin" && user.deleted !== true
    ).length;
    const collaborators = users.filter(
      (user) => user.role === "collaborator" && user.deleted !== true
    ).length;

    return {
      total,
      active,
      admins,
      collaborators,
    };
  }, [users]);

  const visibleUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return users.filter((user) => {
      if (user.deleted === true && statusFilter !== "deleted") {
        return false;
      }

      const userDepartmentNames = getUserDepartmentNames(user, departments);
      const userDepartmentIds = getUserDepartmentIds(user);

      const searchableText = [
        user.name,
        user.email,
        user.area,
        user.role,
        user.privilege,
        ...userDepartmentNames,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = !term || searchableText.includes(term);

      const matchesArea =
        areaFilter === "all" ||
        userDepartmentIds.includes(areaFilter) ||
        user.area === getDepartmentNameById(areaFilter, departments);

      const matchesPrivilege =
        privilegeFilter === "all" || user.role === privilegeFilter;

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" &&
          user.active === true &&
          user.deleted !== true) ||
        (statusFilter === "inactive" &&
          user.active === false &&
          user.deleted !== true) ||
        (statusFilter === "deleted" && user.deleted === true);

      return matchesSearch && matchesArea && matchesPrivilege && matchesStatus;
    });
  }, [users, departments, searchTerm, areaFilter, privilegeFilter, statusFilter]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!selectedUser && users.length > 0) {
      const firstVisibleUser =
        users.find((user) => user.deleted !== true) || users[0];

      selectUser(firstVisibleUser);
    }
  }, [users, selectedUser]);

  async function loadData() {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const departmentsResult = await getActiveDepartments();
      const usersResult = await getAllUsers();

      setDepartments(departmentsResult);
      setUsers(usersResult);

      if (usersResult.length > 0) {
        const firstVisibleUser =
          usersResult.find((user) => user.deleted !== true) || usersResult[0];

        selectUser(firstVisibleUser, departmentsResult);
      }
    } catch (loadError) {
      console.error("No se pudieron cargar los usuarios:", loadError);
      setError(
        "No se pudieron cargar los colaboradores. Revisa permisos de Firestore o conexión."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadUsers(preferredUserId = selectedUserId) {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const result = await getAllUsers();
      setUsers(result);

      if (result.length > 0) {
        const preferredUser =
          result.find((user) => user.id === preferredUserId) ||
          result.find((user) => user.uid === preferredUserId);

        const firstVisibleUser =
          preferredUser ||
          result.find((user) => user.deleted !== true) ||
          result[0];

        selectUser(firstVisibleUser);
      }
    } catch (loadError) {
      console.error("No se pudieron cargar los usuarios:", loadError);
      setError(
        "No se pudieron cargar los colaboradores. Revisa permisos de Firestore o conexión."
      );
    } finally {
      setLoading(false);
    }
  }

  function selectUser(user, departmentsSource = departments) {
    if (!user) {
      setSelectedUserId("");
      setSelectedUserDraft(null);
      return;
    }

    const departmentIds = getDepartmentIdsForDraft(user, departmentsSource);
    const departmentNames = getDepartmentNamesByIds(
      departmentIds,
      departmentsSource
    );
    const area = departmentNames[0] || user.area || "";

    setSelectedUserId(user.id);
    setSelectedUserDraft({
      name: user.name || "",
      email: user.email || "",
      area,
      role: user.role || "collaborator",
      privilege: user.privilege || user.role || "collaborator",
      active: user.active !== false,
      notes: user.notes || "",
      departmentIds,
    });
    setMessage("");
    setError("");
  }

  function updateDraft(field, value) {
    setSelectedUserDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateNewUserDraft(field, value) {
    setNewUserDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function toggleSelectedUserDepartment(departmentId) {
    setSelectedUserDraft((current) => {
      if (!current) return current;

      const currentIds = normalizeDepartmentIds(
        current.departmentIds,
        departments
      );

      const exists = currentIds.includes(departmentId);

      const nextDepartmentIds = exists
        ? currentIds.filter((id) => id !== departmentId)
        : [...currentIds, departmentId];

      const nextDepartmentNames = getDepartmentNamesByIds(
        nextDepartmentIds,
        departments
      );

      return {
        ...current,
        departmentIds: nextDepartmentIds,
        area: nextDepartmentNames[0] || "",
      };
    });
  }

  function toggleNewUserDepartment(departmentId) {
    setNewUserDraft((current) => {
      const currentIds = normalizeDepartmentIds(
        current.departmentIds,
        departments
      );

      const exists = currentIds.includes(departmentId);

      const nextDepartmentIds = exists
        ? currentIds.filter((id) => id !== departmentId)
        : [...currentIds, departmentId];

      const nextDepartmentNames = getDepartmentNamesByIds(
        nextDepartmentIds,
        departments
      );

      return {
        ...current,
        departmentIds: nextDepartmentIds,
        area: nextDepartmentNames[0] || "",
      };
    });
  }

  function openCreateUserModal() {
    setCreatedTemporaryPassword("");
    setNewUserDraft(EMPTY_NEW_USER);
    setError("");
    setMessage("");
    setShowCreateUserModal(true);
  }

  function closeCreateUserModal() {
    setShowCreateUserModal(false);
    setCreatedTemporaryPassword("");
    setNewUserDraft(EMPTY_NEW_USER);
  }

  async function handleCreateUser() {
    const name = newUserDraft.name.trim();
    const email = newUserDraft.email.trim().toLowerCase();
    const role = newUserDraft.role || "collaborator";
    const notes = newUserDraft.notes.trim();

    const departmentIds = Array.isArray(newUserDraft.departmentIds)
      ? newUserDraft.departmentIds
      : [];

    const departmentNames = getDepartmentNamesByIds(departmentIds, departments);
    const primaryDepartmentId = departmentIds[0] || "";
    const area = departmentNames[0] || "";

    if (!name) {
      setError("Escribe el nombre completo del usuario.");
      return;
    }

    if (!email || !email.includes("@")) {
      setError("Escribe un correo electrónico válido.");
      return;
    }

    if (departmentIds.length === 0) {
      setError("Selecciona al menos un departamento para el usuario.");
      return;
    }

    setCreatingUser(true);
    setError("");
    setMessage("");
    setCreatedTemporaryPassword("");

    try {
      const result = await createUserByAdmin({
        name,
        email,
        area,
        role,
        notes,
        active: true,
      });

      if (result?.uid) {
        await updateUserProfile(
          result.uid,
          {
            area,
            department: area,
            departmentName: area,
            departmentIds,
            departmentNames,
            primaryDepartmentId,
          },
          profile
        );
      }

      setCreatedTemporaryPassword(result.temporaryPassword || "");
      setMessage("Usuario creado correctamente.");

      const refreshedUsers = await getAllUsers();
      setUsers(refreshedUsers);

      const createdUser =
        refreshedUsers.find((user) => user.id === result.uid) ||
        refreshedUsers.find((user) => user.email === email);

      if (createdUser) {
        selectUser(createdUser);
      }
    } catch (createError) {
      console.error("No se pudo crear el usuario:", createError);
      setError(
        createError?.message ||
          "No se pudo crear el usuario. Revisa los datos e intenta nuevamente."
      );
    } finally {
      setCreatingUser(false);
    }
  }

  async function handleSaveChanges() {
    if (!selectedUser || !selectedUserDraft) {
      return;
    }

    const departmentIds = normalizeDepartmentIds(
      selectedUserDraft.departmentIds,
      departments
    );

    const departmentNames = getDepartmentNamesByIds(departmentIds, departments);
    const primaryDepartmentId = departmentIds[0] || "";
    const area = departmentNames[0] || selectedUserDraft.area || "";

    if (departmentIds.length === 0) {
      setError("Selecciona al menos un departamento para este usuario.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await updateUserProfile(
        selectedUser.id,
        {
          name: selectedUserDraft.name.trim(),
          email: selectedUserDraft.email.trim().toLowerCase(),
          area,
          department: area,
          departmentName: area,
          departmentIds,
          departmentNames,
          primaryDepartmentId,
          role: selectedUserDraft.role,
          privilege: selectedUserDraft.privilege || selectedUserDraft.role,
          active: selectedUserDraft.active,
          notes: selectedUserDraft.notes.trim(),
        },
        profile
      );

      if (selectedUser.id === profile?.uid || selectedUser.id === profile?.id) {
        await refreshProfile?.();
      }

      setMessage("Cambios guardados correctamente.");
      await loadUsers(selectedUser.id);
    } catch (saveError) {
      console.error("No se pudieron guardar los cambios:", saveError);
      setError("No se pudieron guardar los cambios del colaborador.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivateUser() {
    if (!selectedUser) {
      return;
    }

    const confirmDeactivate = window.confirm(
      `¿Quieres desactivar a ${selectedUser.name || selectedUser.email}?`
    );

    if (!confirmDeactivate) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await deactivateUserProfile(selectedUser.id, profile);
      setMessage("Usuario desactivado correctamente.");
      await loadUsers();
    } catch (deactivateError) {
      console.error("No se pudo desactivar el usuario:", deactivateError);
      setError("No se pudo desactivar el usuario.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRestoreUser() {
    if (!selectedUser) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await restoreUserProfile(selectedUser.id, profile);
      setMessage("Usuario restaurado correctamente.");
      await loadUsers();
    } catch (restoreError) {
      console.error("No se pudo restaurar el usuario:", restoreError);
      setError("No se pudo restaurar el usuario.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSoftDeleteUser() {
    if (!selectedUser) {
      return;
    }

    const confirmDelete = window.confirm(
      `Esta acción ocultará a ${
        selectedUser.name || selectedUser.email
      } del listado normal y lo marcará como eliminado. ¿Deseas continuar?`
    );

    if (!confirmDelete) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await softDeleteUserProfile(selectedUser.id, profile);
      setMessage("Usuario marcado como eliminado.");
      await loadUsers();
    } catch (deleteError) {
      console.error("No se pudo eliminar el usuario:", deleteError);
      setError("No se pudo eliminar el usuario.");
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPassword() {
    if (!selectedUser?.email) {
      setError("Este usuario no tiene correo registrado.");
      return;
    }

    const confirmReset = window.confirm(
      `Se enviará un correo para restablecer la contraseña a ${selectedUser.email}. ¿Deseas continuar?`
    );

    if (!confirmReset) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await sendUserPasswordReset(selectedUser.email);
      setMessage("Correo de restablecimiento de contraseña enviado.");
    } catch (resetError) {
      console.error("No se pudo enviar el restablecimiento:", resetError);
      setError(
        "No se pudo enviar el correo de restablecimiento. Verifica que el correo exista en Firebase Auth."
      );
    } finally {
      setSaving(false);
    }
  }

  function clearFilters() {
    setSearchTerm("");
    setAreaFilter("all");
    setPrivilegeFilter("all");
    setStatusFilter("all");
  }

  return (
    <div className="collaborators-admin-page">
      <div className="visual-page-header collaborators-header">
        <div>
          <span className="breadcrumb-line">Panel de administrador</span>
          <h2>Gestión de colaboradores</h2>
          <p>
            Administra usuarios, departamentos y privilegios desde un solo lugar.
          </p>
        </div>

        <div className="visual-page-actions">
          <button
            type="button"
            className="visual-outline-button"
            onClick={loadData}
            disabled={loading || saving || creatingUser}
          >
            ↻ Actualizar
          </button>

          <button
            type="button"
            className="visual-primary-button"
            onClick={openCreateUserModal}
            disabled={loading || saving || creatingUser}
          >
            + Agregar usuario
          </button>
        </div>
      </div>

      {message && <div className="message-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <section className="collaborator-metrics-grid">
        <MetricCard
          icon="👥"
          label="Usuarios totales"
          value={stats.total}
          hint="Perfiles registrados"
          colorClass="metric-blue"
        />

        <MetricCard
          icon="●"
          label="Activos"
          value={stats.active}
          hint={`${getPercentage(stats.active, stats.total)}% del total`}
          colorClass="metric-green"
        />

        <MetricCard
          icon="🛡"
          label="Administradores"
          value={stats.admins}
          hint={`${getPercentage(stats.admins, stats.total)}% del total`}
          colorClass="metric-purple"
        />

        <MetricCard
          icon="☷"
          label="Colaboradores"
          value={stats.collaborators}
          hint={`${getPercentage(stats.collaborators, stats.total)}% del total`}
          colorClass="metric-orange"
        />
      </section>

      <section className="collaborators-layout">
        <div className="collaborators-main-card">
          <div className="collaborators-toolbar">
            <div className="visual-search collaborators-search">
              <span>⌕</span>
              <input
                type="text"
                placeholder="Buscar por nombre, correo o departamento..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>

            <select
              value={areaFilter}
              onChange={(event) => setAreaFilter(event.target.value)}
            >
              <option value="all">Todos los departamentos</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>

            <select
              value={privilegeFilter}
              onChange={(event) => setPrivilegeFilter(event.target.value)}
            >
              <option value="all">Todos los privilegios</option>
              {PRIVILEGE_OPTIONS.map((privilege) => (
                <option key={privilege.value} value={privilege.value}>
                  {privilege.label}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">Todos los estados</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
              <option value="deleted">Eliminados</option>
            </select>

            <button
              type="button"
              className="visual-outline-button clear-users-filter"
              onClick={clearFilters}
            >
              Limpiar
            </button>
          </div>

          {loading ? (
            <div className="empty-state">
              <div>⌛</div>
              <p>Cargando colaboradores...</p>
            </div>
          ) : visibleUsers.length === 0 ? (
            <div className="empty-state">
              <div>⌕</div>
              <p>No se encontraron usuarios con esos filtros.</p>
            </div>
          ) : (
            <>
              <div className="visual-table-wrap">
                <table className="visual-table collaborators-table">
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Correo</th>
                      <th>Departamentos</th>
                      <th>Privilegio</th>
                      <th>Estatus</th>
                      <th>Última actividad</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>

                  <tbody>
                    {visibleUsers.map((user) => (
                      <tr
                        key={user.id}
                        className={
                          selectedUserId === user.id ? "selected-user-row" : ""
                        }
                        onClick={() => selectUser(user)}
                      >
                        <td>
                          <div className="user-name-cell">
                            <div className="avatar-mini">
                              {getInitials(user.name || user.email)}
                            </div>

                            <div>
                              <strong>{user.name || "Sin nombre"}</strong>
                              <small>{user.id}</small>
                            </div>
                          </div>
                        </td>

                        <td>{user.email || "Sin correo"}</td>

                        <td>
                          <DepartmentChips
                            departmentNames={getUserDepartmentNames(user, departments)}
                            fallbackArea={user.area}
                          />
                        </td>

                        <td>
                          <span
                            className={`role-chip ${getRoleClass(user.role)}`}
                          >
                            {getRoleLabel(user.role)}
                          </span>
                        </td>

                        <td>
                          <span
                            className={`status-chip ${
                              user.deleted
                                ? "status-deleted"
                                : user.active
                                ? "status-active"
                                : "status-inactive"
                            }`}
                          >
                            {user.deleted
                              ? "Eliminado"
                              : user.active
                              ? "Activo"
                              : "Inactivo"}
                          </span>
                        </td>

                        <td>{formatDate(user.lastLoginAt || user.updatedAt)}</td>

                        <td>
                          <button
                            type="button"
                            className="table-dot-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              selectUser(user);
                            }}
                          >
                            ⋮
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="collaborators-table-footer">
                <span>
                  Mostrando {visibleUsers.length} de {footerTotalUsers}{" "}
                  {footerUserLabel}
                </span>

                <span>Página 1</span>
              </div>
            </>
          )}
        </div>

        <aside className="collaborator-editor-card">
          {!selectedUserDraft ? (
            <div className="empty-state small">
              <div>👤</div>
              <p>Selecciona un colaborador para editarlo.</p>
            </div>
          ) : (
            <>
              <div className="collaborator-editor-header">
                <div className="profile-page-avatar small-avatar">
                  {getInitials(selectedUserDraft.name || selectedUserDraft.email)}
                </div>

                <div>
                  <h3>Editar colaborador</h3>
                  <strong>
                    {selectedUserDraft.name || "Usuario sin nombre"}
                  </strong>
                  <span>{selectedUserDraft.email || "Sin correo"}</span>
                </div>
              </div>

              <div className="collaborator-editor-form">
                <label>
                  Nombre completo
                  <input
                    type="text"
                    value={selectedUserDraft.name}
                    onChange={(event) =>
                      updateDraft("name", event.target.value)
                    }
                  />
                </label>

                <label>
                  Correo electrónico
                  <input
                    type="email"
                    value={selectedUserDraft.email}
                    onChange={(event) =>
                      updateDraft("email", event.target.value)
                    }
                  />
                </label>

                <div className="collaborator-editor-two-columns">
                  <label>
                    Privilegio
                    <select
                      value={selectedUserDraft.role}
                      onChange={(event) => {
                        updateDraft("role", event.target.value);
                        updateDraft("privilege", event.target.value);
                      }}
                    >
                      {PRIVILEGE_OPTIONS.map((privilege) => (
                        <option key={privilege.value} value={privilege.value}>
                          {privilege.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Estado
                    <select
                      value={selectedUserDraft.active ? "active" : "inactive"}
                      onChange={(event) =>
                        updateDraft("active", event.target.value === "active")
                      }
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <DepartmentSelector
                  title="Departamentos"
                  helperText="Selecciona una o varias áreas. El primer departamento será el área principal."
                  departments={departments}
                  selectedDepartmentIds={selectedUserDraft.departmentIds}
                  onToggleDepartment={toggleSelectedUserDepartment}
                  disabled={saving || creatingUser}
                />

                <div className="collaborator-primary-area-card">
                  <span>Área principal</span>
                  <strong>
                    {getDepartmentNamesByIds(
                      selectedUserDraft.departmentIds,
                      departments
                    )[0] ||
                      selectedUserDraft.area ||
                      "Sin área principal"}
                  </strong>
                  <small>
                    Se toma automáticamente del primer departamento seleccionado.
                  </small>
                </div>

                <label>
                  Observaciones
                  <textarea
                    value={selectedUserDraft.notes}
                    onChange={(event) =>
                      updateDraft("notes", event.target.value)
                    }
                    placeholder="Agrega notas administrativas sobre este colaborador..."
                  />
                </label>
              </div>

              <div className="collaborator-editor-actions">
                <button
                  type="button"
                  className="visual-primary-button"
                  onClick={handleSaveChanges}
                  disabled={saving || creatingUser}
                >
                  Guardar cambios
                </button>

                <button
                  type="button"
                  className="visual-outline-button"
                  onClick={handleResetPassword}
                  disabled={saving || creatingUser}
                >
                  Restablecer contraseña
                </button>

                {selectedUser?.active === false || selectedUser?.deleted ? (
                  <button
                    type="button"
                    className="restore-user-button"
                    onClick={handleRestoreUser}
                    disabled={saving || creatingUser}
                  >
                    Restaurar usuario
                  </button>
                ) : (
                  <button
                    type="button"
                    className="deactivate-user-button"
                    onClick={handleDeactivateUser}
                    disabled={saving || creatingUser}
                  >
                    Desactivar usuario
                  </button>
                )}

                <button
                  type="button"
                  className="delete-user-button"
                  onClick={handleSoftDeleteUser}
                  disabled={saving || creatingUser}
                >
                  Eliminar usuario
                </button>
              </div>

              <div className="new-user-hint-card">
                <strong>Nuevo usuario</strong>
                <p>
                  El botón “Agregar usuario” crea la cuenta en Firebase
                  Authentication y también genera su perfil en Firestore.
                </p>
              </div>
            </>
          )}
        </aside>
      </section>

      {showCreateUserModal && (
        <div className="modal-backdrop">
          <div className="create-user-modal">
            <div className="create-user-modal-header">
              <div>
                <h3>Nuevo usuario</h3>
                <p>
                  Crea una cuenta nueva y asígnale departamentos y privilegio
                  dentro del sistema.
                </p>
              </div>

              <button type="button" onClick={closeCreateUserModal}>
                ×
              </button>
            </div>

            <div className="create-user-form">
              <label>
                Nombre completo
                <input
                  type="text"
                  value={newUserDraft.name}
                  onChange={(event) =>
                    updateNewUserDraft("name", event.target.value)
                  }
                  placeholder="Ej. María González"
                />
              </label>

              <label>
                Correo electrónico
                <input
                  type="email"
                  value={newUserDraft.email}
                  onChange={(event) =>
                    updateNewUserDraft("email", event.target.value)
                  }
                  placeholder="maria@activeenglish.mx"
                />
              </label>

              <div className="full">
                <DepartmentSelector
                  title="Departamentos"
                  helperText="Selecciona al menos un departamento para crear el usuario."
                  departments={departments}
                  selectedDepartmentIds={newUserDraft.departmentIds}
                  onToggleDepartment={toggleNewUserDepartment}
                  disabled={creatingUser}
                  compact={false}
                />
              </div>

              <label>
                Privilegio
                <select
                  value={newUserDraft.role}
                  onChange={(event) =>
                    updateNewUserDraft("role", event.target.value)
                  }
                >
                  {PRIVILEGE_OPTIONS.map((privilege) => (
                    <option key={privilege.value} value={privilege.value}>
                      {privilege.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Área principal
                <input
                  type="text"
                  value={
                    getDepartmentNamesByIds(
                      newUserDraft.departmentIds,
                      departments
                    )[0] || ""
                  }
                  disabled
                  placeholder="Se asignará automáticamente"
                />
              </label>

              <label className="full">
                Observaciones
                <textarea
                  value={newUserDraft.notes}
                  onChange={(event) =>
                    updateNewUserDraft("notes", event.target.value)
                  }
                  placeholder="Notas internas sobre este usuario..."
                />
              </label>
            </div>

            {createdTemporaryPassword && (
              <div className="temporary-password-box">
                <strong>Contraseña temporal generada:</strong>
                <code>{createdTemporaryPassword}</code>
                <p>
                  Copia esta contraseña y entrégala al usuario. Después podrá
                  cambiarla desde el correo de restablecimiento.
                </p>
              </div>
            )}

            <div className="create-user-modal-actions">
              <button
                type="button"
                className="visual-outline-button"
                onClick={closeCreateUserModal}
              >
                Cerrar
              </button>

              <button
                type="button"
                className="visual-primary-button"
                onClick={handleCreateUser}
                disabled={
                  creatingUser ||
                  !newUserDraft.name.trim() ||
                  !newUserDraft.email.trim() ||
                  !Array.isArray(newUserDraft.departmentIds) ||
                  newUserDraft.departmentIds.length === 0
                }
              >
                {creatingUser ? "Creando..." : "Crear usuario"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DepartmentSelector({
  title,
  helperText,
  departments = [],
  selectedDepartmentIds = [],
  onToggleDepartment,
  disabled = false,
  compact = true,
}) {
  const selectedIds = Array.isArray(selectedDepartmentIds)
    ? selectedDepartmentIds
    : [];

  return (
    <div className="department-selection-panel">
      <div className="department-selection-header">
        <div>
          <span>{title}</span>
          {helperText && <p>{helperText}</p>}
        </div>

        <strong>{selectedIds.length} seleccionados</strong>
      </div>

      {departments.length === 0 ? (
        <p className="empty-state small">
          No hay departamentos activos registrados.
        </p>
      ) : (
        <div
          className={
            compact
              ? "department-select-grid compact"
              : "department-select-grid"
          }
        >
          {departments.map((department) => {
            const selected = selectedIds.includes(department.id);

            return (
              <button
                key={department.id}
                type="button"
                className={
                  selected
                    ? "department-select-card selected"
                    : "department-select-card"
                }
                onClick={() => onToggleDepartment?.(department.id)}
                disabled={disabled}
              >
                <span className={`department-select-icon ${getAreaClass(department.name)}`}>
                  {getDepartmentIcon(department.name)}
                </span>

                <strong>{department.name}</strong>

                <span className="department-select-check">
                  {selected ? "✓" : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MetricCard({ icon, label, value, hint, colorClass }) {
  return (
    <article className={`metric-card visual-metric ${colorClass}`}>
      <div className="metric-icon">{icon}</div>

      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <p>{hint}</p>
      </div>
    </article>
  );
}

function DepartmentChips({ departmentNames = [], fallbackArea = "" }) {
  const names =
    Array.isArray(departmentNames) && departmentNames.length > 0
      ? departmentNames
      : fallbackArea
      ? [fallbackArea]
      : [];

  if (names.length === 0) {
    return <span className="area-chip area-gray">Sin departamento</span>;
  }

  return (
    <div className="department-chip-list">
      {names.map((name) => (
        <span key={name} className={`area-chip ${getAreaClass(name)}`}>
          {name}
        </span>
      ))}
    </div>
  );
}

function getPercentage(value, total) {
  if (!total) {
    return 0;
  }

  return Math.round((value / total) * 100);
}

function getInitials(name = "") {
  const initials = String(name)
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || "U";
}

function getRoleLabel(role = "") {
  const labels = {
    admin: "Administrador",
    collaborator: "Colaborador",
    requester: "Solicitante",
  };

  return labels[role] || role || "Usuario";
}

function getRoleClass(role = "") {
  const classes = {
    admin: "role-admin",
    collaborator: "role-collaborator",
    requester: "role-requester",
  };

  return classes[role] || "role-collaborator";
}

function getDepartmentIcon(name = "") {
  const normalizedName = String(name).toLowerCase();

  if (normalizedName.includes("audiovisual")) return "🎬";
  if (normalizedName.includes("software")) return "⌨";
  if (normalizedName.includes("material")) return "📚";
  if (normalizedName.includes("redes")) return "💬";
  if (normalizedName.includes("imprenta")) return "🖨";
  if (normalizedName.includes("soporte")) return "🎧";
  if (normalizedName.includes("dirección")) return "🏛";
  if (normalizedName.includes("general")) return "▦";

  return "▤";
}

function getAreaClass(area = "") {
  const normalizedArea = area.toLowerCase();

  if (normalizedArea.includes("software")) {
    return "area-purple";
  }

  if (normalizedArea.includes("audiovisual")) {
    return "area-blue";
  }

  if (normalizedArea.includes("material")) {
    return "area-teal";
  }

  if (
    normalizedArea.includes("soporte") ||
    normalizedArea.includes("imprenta")
  ) {
    return "area-red";
  }

  if (normalizedArea.includes("redes")) {
    return "area-orange";
  }

  if (normalizedArea.includes("administración")) {
    return "area-gold";
  }

  return "area-gray";
}

function normalizeComparableText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizeDepartmentIds(ids = [], departmentsSource = []) {
  if (!Array.isArray(ids)) {
    return [];
  }

  const validIds = new Set(departmentsSource.map((department) => department.id));

  return ids
    .filter(Boolean)
    .filter((id) => validIds.size === 0 || validIds.has(id))
    .filter((id, index, array) => array.indexOf(id) === index);
}

function getDepartmentByName(name = "", departmentsSource = []) {
  const normalizedName = normalizeComparableText(name);

  if (!normalizedName) {
    return null;
  }

  return (
    departmentsSource.find(
      (department) => normalizeComparableText(department.name) === normalizedName
    ) || null
  );
}

function getUserDepartmentIds(user, departmentsSource = []) {
  const idsFromUser = normalizeDepartmentIds(user?.departmentIds, departmentsSource);

  if (idsFromUser.length > 0) {
    return idsFromUser;
  }

  return getDepartmentIdsForDraft(user, departmentsSource);
}

function getUserDepartmentNames(user, departmentsSource = []) {
  const ids = getUserDepartmentIds(user, departmentsSource);
  const namesFromIds = getDepartmentNamesByIds(ids, departmentsSource);

  if (namesFromIds.length > 0) {
    return namesFromIds;
  }

  const legacyNames = [
    ...(Array.isArray(user?.departmentNames) ? user.departmentNames : []),
    user?.departmentName,
    user?.department,
    user?.area,
  ]
    .filter(Boolean)
    .map((name) => String(name).trim())
    .filter(Boolean);

  return legacyNames.filter(
    (name, index, array) =>
      array.findIndex(
        (item) => normalizeComparableText(item) === normalizeComparableText(name)
      ) === index
  );
}

function getDepartmentIdsForDraft(user, departmentsSource = []) {
  const validIds = normalizeDepartmentIds(user?.departmentIds, departmentsSource);

  if (validIds.length > 0) {
    return validIds;
  }

  const legacyNames = [
    ...(Array.isArray(user?.departmentNames) ? user.departmentNames : []),
    user?.departmentName,
    user?.department,
    user?.area,
  ].filter(Boolean);

  const idsFromLegacyNames = legacyNames
    .map((name) => getDepartmentByName(name, departmentsSource)?.id || "")
    .filter(Boolean);

  return normalizeDepartmentIds(idsFromLegacyNames, departmentsSource);
}

function getDepartmentNamesByIds(ids = [], departmentsSource = []) {
  return normalizeDepartmentIds(ids, departmentsSource)
    .map((id) => {
      const department = departmentsSource.find((item) => item.id === id);
      return department?.name || "";
    })
    .filter(Boolean);
}

function getDepartmentNameById(id, departmentsSource = []) {
  const department = departmentsSource.find((item) => item.id === id);
  return department?.name || "";
}

function formatDate(value) {
  if (!value) {
    return "Sin registro";
  }

  try {
    const date = typeof value.toDate === "function" ? value.toDate() : value;

    return new Intl.DateTimeFormat("es-MX", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return "Sin registro";
  }
}