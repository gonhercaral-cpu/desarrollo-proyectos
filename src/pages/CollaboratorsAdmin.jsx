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
  updateUserByAdmin,
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
  const [showFocusedEditor, setShowFocusedEditor] = useState(false);

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

  function selectUser(user, departmentsSource = departments, openEditor = false) {
    if (!user) {
      setSelectedUserId("");
      setSelectedUserDraft(null);
      setShowFocusedEditor(false);
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

    if (openEditor) {
      setShowFocusedEditor(true);
    }
  }

  function openFocusedEditor(user = selectedUser) {
    if (!user) return;
    selectUser(user, departments, true);
  }

  function closeFocusedEditor() {
    setShowFocusedEditor(false);
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
      await updateUserByAdmin(
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
        }
      );

      if (selectedUser.id === profile?.uid || selectedUser.id === profile?.id) {
        await refreshProfile?.();
      }

      setMessage("Cambios guardados correctamente.");
      await loadUsers(selectedUser.id);
    } catch (saveError) {
      console.error("No se pudieron guardar los cambios:", saveError);
      setError(saveError?.message || "No se pudieron guardar los cambios del colaborador.");
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
      <section className="printshop-topbar collaborators-topbar">
        <div className="printshop-topbar-main">
          <span className="printshop-topbar-module-icon">
            <Icon name="users" />
          </span>

          <div className="printshop-topbar-copy">
            <p className="printshop-kicker">ADMINISTRACIÓN</p>
            <h1>Colaboradores</h1>
            <p>
              Administra usuarios, departamentos, privilegios y accesos del equipo desde un solo lugar.
            </p>
          </div>
        </div>

        <div className="collaborators-topbar-actions">
          <button
            type="button"
            className="collaborators-topbar-button secondary"
            onClick={loadData}
            disabled={loading || saving || creatingUser}
          >
            <Icon name="refresh" />
            Actualizar
          </button>

          <button
            type="button"
            className="collaborators-topbar-button primary"
            onClick={openCreateUserModal}
            disabled={loading || saving || creatingUser}
          >
            <Icon name="plus" />
            Agregar usuario
          </button>
        </div>
      </section>

      {message && <div className="message-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      {showFocusedEditor && selectedUserDraft ? (
        <section className="collaborator-focused-editor">
          <div className="collaborator-focused-heading">
            <div className="collaborator-focused-title">
              <div className="profile-page-avatar collaborator-focused-avatar">
                {getInitials(selectedUserDraft.name || selectedUserDraft.email)}
              </div>

              <div>
                <span>VISTA ENFOCADA</span>
                <h2>Editar colaborador</h2>
                <p>Actualiza información, departamentos, privilegios y estado sin saturar la pantalla principal.</p>
              </div>
            </div>

            <div className="collaborator-focused-actions">
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
                onClick={closeFocusedEditor}
                disabled={saving || creatingUser}
              >
                ← Volver a colaboradores
              </button>
            </div>
          </div>

          <div className="collaborator-focused-layout">
            <div className="collaborator-focused-main-card">
              <div className="collaborator-focus-section-header">
                <span className="collaborators-section-icon"><Icon name="idCard" /></span>
                <div>
                  <h3>Datos del colaborador</h3>
                  <p>Edita los datos principales y el acceso del usuario seleccionado.</p>
                </div>
              </div>

              <div className="collaborator-focused-form">
                <label>
                  Nombre completo
                  <input
                    type="text"
                    value={selectedUserDraft.name}
                    onChange={(event) => updateDraft("name", event.target.value)}
                  />
                </label>

                <label>
                  Correo electrónico
                  <input
                    type="email"
                    value={selectedUserDraft.email}
                    onChange={(event) => updateDraft("email", event.target.value)}
                  />
                </label>

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

                <div className="collaborator-focused-full">
                  <DepartmentSelector
                    title="Departamentos"
                    helperText="Selecciona una o varias áreas. El primer departamento será el área principal."
                    departments={departments}
                    selectedDepartmentIds={selectedUserDraft.departmentIds}
                    onToggleDepartment={toggleSelectedUserDepartment}
                    disabled={saving || creatingUser}
                    compact={false}
                  />
                </div>

                <div className="collaborator-primary-area-card collaborator-focused-full">
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

                <label className="collaborator-focused-full">
                  Observaciones
                  <textarea
                    value={selectedUserDraft.notes}
                    onChange={(event) => updateDraft("notes", event.target.value)}
                    placeholder="Agrega notas administrativas sobre este colaborador..."
                  />
                </label>
              </div>
            </div>

            <aside className="collaborator-focused-side-card">
              <div className="collaborator-focus-profile-card">
                <div className="profile-page-avatar collaborator-focused-avatar large">
                  {getInitials(selectedUserDraft.name || selectedUserDraft.email)}
                </div>

                <h3>{selectedUserDraft.name || "Usuario sin nombre"}</h3>
                <p>{selectedUserDraft.email || "Sin correo"}</p>

                <div className="collaborator-focus-badges">
                  <span className={`role-chip ${getRoleClass(selectedUserDraft.role)}`}>
                    {getRoleLabel(selectedUserDraft.role)}
                  </span>
                  <span
                    className={`status-chip ${
                      selectedUserDraft.active ? "status-active" : "status-inactive"
                    }`}
                  >
                    {selectedUserDraft.active ? "Activo" : "Inactivo"}
                  </span>
                </div>
              </div>

              <div className="collaborator-focus-actions-card">
                <h3>Acciones rápidas</h3>

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
            </aside>
          </div>
        </section>
      ) : (
        <>
      <section className="collaborator-metrics-grid">
        <MetricCard
          icon={<Icon name="users" />}
          label="Usuarios totales"
          value={stats.total}
          hint="Perfiles registrados"
          colorClass="metric-blue"
        />

        <MetricCard
          icon={<Icon name="checkCircle" />}
          label="Activos"
          value={stats.active}
          hint={`${getPercentage(stats.active, stats.total)}% del total`}
          colorClass="metric-green"
        />

        <MetricCard
          icon={<Icon name="shield" />}
          label="Administradores"
          value={stats.admins}
          hint={`${getPercentage(stats.admins, stats.total)}% del total`}
          colorClass="metric-purple"
        />

        <MetricCard
          icon={<Icon name="idCard" />}
          label="Colaboradores"
          value={stats.collaborators}
          hint={`${getPercentage(stats.collaborators, stats.total)}% del total`}
          colorClass="metric-orange"
        />
      </section>

      <section className="collaborators-layout">
        <div className="collaborators-main-card">
          <div className="collaborators-list-header">
            <div>
              <span className="collaborators-section-icon"><Icon name="list" /></span>
              <div>
                <h2>Usuarios registrados</h2>
                <p>Filtra, revisa y selecciona un colaborador para editar su perfil.</p>
              </div>
            </div>

            <strong>{visibleUsers.length} visibles</strong>
          </div>

          <div className="collaborators-toolbar">
            <div className="visual-search collaborators-search">
              <span><Icon name="search" /></span>
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
                            className="collaborators-row-action"
                            onClick={(event) => {
                              event.stopPropagation();
                              selectUser(user, departments, true);
                            }}
                          >
                            Ver
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

        <aside className="collaborator-editor-card collaborator-quick-card">
          {!selectedUserDraft ? (
            <div className="empty-state small">
              <div><Icon name="users" /></div>
              <p>Selecciona un colaborador para ver su información.</p>
            </div>
          ) : (
            <>
              <div className="collaborator-editor-header">
                <div className="profile-page-avatar small-avatar collaborator-editor-avatar">
                  {getInitials(selectedUserDraft.name || selectedUserDraft.email)}
                </div>

                <div>
                  <h3>Detalle rápido</h3>
                  <strong>{selectedUserDraft.name || "Usuario sin nombre"}</strong>
                  <span>{selectedUserDraft.email || "Sin correo"}</span>
                </div>
              </div>

              <div className="collaborator-quick-summary">
                <div>
                  <span>Privilegio</span>
                  <strong>{getRoleLabel(selectedUserDraft.role)}</strong>
                </div>

                <div>
                  <span>Estado</span>
                  <strong>{selectedUserDraft.active ? "Activo" : "Inactivo"}</strong>
                </div>

                <div className="full">
                  <span>Área principal</span>
                  <strong>
                    {getDepartmentNamesByIds(
                      selectedUserDraft.departmentIds,
                      departments
                    )[0] ||
                      selectedUserDraft.area ||
                      "Sin área principal"}
                  </strong>
                </div>

                <div className="full">
                  <span>Departamentos asignados</span>
                  <strong>{selectedUserDraft.departmentIds?.length || 0}</strong>
                </div>
              </div>

              <div className="collaborator-editor-actions">
                <button
                  type="button"
                  className="visual-primary-button"
                  onClick={() => openFocusedEditor()}
                  disabled={saving || creatingUser}
                >
                  Editar en vista enfocada
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
            </>
          )}
        </aside>
      </section>

        </>
      )}

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

function Icon({ name }) {
  const icons = {
    users: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M16 11.2a3.6 3.6 0 1 0-3.58-3.6A3.58 3.58 0 0 0 16 11.2Z" />
        <path d="M8.4 12a3.1 3.1 0 1 0-3.08-3.1A3.09 3.09 0 0 0 8.4 12Z" />
        <path d="M16 13c-3.18 0-5.76 1.8-5.76 4.02V19a1 1 0 0 0 1 1h9.52a1 1 0 0 0 1-1v-1.98C21.76 14.8 19.18 13 16 13Z" />
        <path d="M8.4 13.6C5.42 13.6 3 15.27 3 17.34V19a1 1 0 0 0 1 1h4.42a2.6 2.6 0 0 1-.18-1v-1.98a5.02 5.02 0 0 1 1.24-3.22 7.36 7.36 0 0 0-1.08-.2Z" />
      </svg>
    ),
    refresh: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.2 12.7a8.2 8.2 0 0 1-14.05 5.06 1 1 0 1 1 1.42-1.41 6.2 6.2 0 0 0 10.61-3.65h-1.73a.9.9 0 0 1-.64-1.54l2.87-2.88a.9.9 0 0 1 1.28 0l2.87 2.88a.9.9 0 0 1-.64 1.54h-1.99Z" />
        <path d="M3.8 11.3A8.2 8.2 0 0 1 17.85 6.24a1 1 0 1 1-1.42 1.41A6.2 6.2 0 0 0 5.82 11.3h1.73a.9.9 0 0 1 .64 1.54l-2.87 2.88a.9.9 0 0 1-1.28 0l-2.87-2.88a.9.9 0 0 1 .64-1.54H3.8Z" />
      </svg>
    ),
    plus: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M11 5a1 1 0 0 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 0 1 0-2h6V5Z" />
      </svg>
    ),
    checkCircle: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Zm4.53 7.28-5.08 5.08a1 1 0 0 1-1.42 0l-2.36-2.36a1 1 0 1 1 1.42-1.41l1.65 1.65 4.37-4.37a1 1 0 1 1 1.42 1.41Z" />
      </svg>
    ),
    shield: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.4 4.8 5.1a1.2 1.2 0 0 0-.78 1.12v4.95c0 4.6 2.92 8.72 7.25 10.26.47.17.99.17 1.46 0 4.33-1.54 7.25-5.66 7.25-10.26V6.22a1.2 1.2 0 0 0-.78-1.12L12 2.4Zm3.9 7.55-4.5 4.5a1 1 0 0 1-1.42 0l-1.88-1.88a1 1 0 1 1 1.42-1.42l1.17 1.17 3.8-3.78a1 1 0 0 1 1.41 1.41Z" />
      </svg>
    ),
    idCard: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5.5 4.5h13A2.5 2.5 0 0 1 21 7v10a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17V7a2.5 2.5 0 0 1 2.5-2.5Zm2.25 4A2.25 2.25 0 1 0 10 10.75 2.25 2.25 0 0 0 7.75 8.5Zm-3 7.32c0 .37.3.68.68.68h4.64c.38 0 .68-.3.68-.68 0-1.16-1.34-2.07-3-2.07s-3 .91-3 2.07ZM13 9a1 1 0 0 0 0 2h4a1 1 0 1 0 0-2h-4Zm0 4a1 1 0 1 0 0 2h3a1 1 0 1 0 0-2h-3Z" />
      </svg>
    ),
    list: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6.5 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM9 6h11a1 1 0 1 1 0 2H9a1 1 0 0 1 0-2Zm0 5h11a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2Zm0 5h11a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2Z" />
      </svg>
    ),
    search: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10.5 4a6.5 6.5 0 0 1 5.16 10.45l3.44 3.45a1 1 0 0 1-1.41 1.41l-3.45-3.44A6.5 6.5 0 1 1 10.5 4Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />
      </svg>
    ),
    printer: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3.5h10a1 1 0 0 1 1 1V8H6V4.5a1 1 0 0 1 1-1Zm-1 13H5a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3.5a2 2 0 0 1-2 2h-1v-3H6v3Zm2-1h8v4H8v-4Z" />
      </svg>
    ),
    headset: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3a8 8 0 0 0-8 8v3.5A2.5 2.5 0 0 0 6.5 17H8a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H6.1a6 6 0 0 1 11.8 0H16a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h1.5a2.48 2.48 0 0 0 1.4-.43 4.2 4.2 0 0 1-4.05 3.13H13a1 1 0 1 0 0 2h1.85A6.2 6.2 0 0 0 21 15.5V11a8 8 0 0 0-9-8Z" />
      </svg>
    ),
    code: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8.7 7.3a1 1 0 0 1 0 1.4L5.41 12l3.3 3.3a1 1 0 1 1-1.42 1.4l-4-4a1 1 0 0 1 0-1.4l4-4a1 1 0 0 1 1.42 0Zm6.6 0a1 1 0 0 1 1.4 0l4 4a1 1 0 0 1 0 1.4l-4 4a1 1 0 0 1-1.4-1.4l3.29-3.3-3.3-3.3a1 1 0 0 1 0-1.4ZM13.96 5a1 1 0 0 1 .7 1.23l-3 12a1 1 0 1 1-1.94-.48l3-12a1 1 0 0 1 1.24-.75Z" />
      </svg>
    ),
    book: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19a1 1 0 0 1 1 1v15.5a1 1 0 0 1-1 1H7.5A2.5 2.5 0 0 0 5 22V4.5Zm3 1.75a1 1 0 0 0 0 2h7a1 1 0 1 0 0-2H8Zm0 4a1 1 0 1 0 0 2h7a1 1 0 1 0 0-2H8Z" />
      </svg>
    ),
    chat: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5.5A3.5 3.5 0 0 1 7.5 2h9A3.5 3.5 0 0 1 20 5.5v6A3.5 3.5 0 0 1 16.5 15h-5.56l-4.2 3.43A1.05 1.05 0 0 1 5 17.62V15.1A3.5 3.5 0 0 1 4 12.64V5.5Zm4 1.75a1 1 0 0 0 0 2h8a1 1 0 1 0 0-2H8Zm0 4a1 1 0 1 0 0 2h5.5a1 1 0 1 0 0-2H8Z" />
      </svg>
    ),
    building: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 20h16a1 1 0 1 1 0 2H4a1 1 0 1 1 0-2Zm1-9.25a1.5 1.5 0 0 1 .83-1.34l5.5-2.75a1.5 1.5 0 0 1 1.34 0l5.5 2.75A1.5 1.5 0 0 1 19 10.75V18h-2v-6h-2v6h-2v-6h-2v6H9v-6H7v6H5v-7.25ZM12 2.2l8.2 4.1a1 1 0 0 1-.9 1.8L12 4.45 4.7 8.1a1 1 0 0 1-.9-1.8L12 2.2Z" />
      </svg>
    ),
    grid: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z" />
      </svg>
    ),
    monitor: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-5v2h2a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h2v-2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v9h14V6H5Z" />
      </svg>
    ),
  };

  return <span className="collaborators-svg-icon">{icons[name] || icons.users}</span>;
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

  if (normalizedName.includes("audiovisual")) return <Icon name="monitor" />;
  if (normalizedName.includes("software")) return <Icon name="code" />;
  if (normalizedName.includes("material")) return <Icon name="book" />;
  if (normalizedName.includes("redes")) return <Icon name="chat" />;
  if (normalizedName.includes("imprenta")) return <Icon name="printer" />;
  if (normalizedName.includes("soporte")) return <Icon name="headset" />;
  if (normalizedName.includes("dirección")) return <Icon name="building" />;
  if (normalizedName.includes("general")) return <Icon name="grid" />;

  return <Icon name="grid" />;
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
