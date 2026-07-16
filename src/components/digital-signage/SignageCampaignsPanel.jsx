import {
  PUBLISH_STATUS_OPTIONS,
  WEEKDAY_OPTIONS,
  getPublishStatus,
  isPublished,
} from "../../utils/digitalSignage";

export default function SignageCampaignsPanel({
  campaigns,
  playlists,
  form,
  editingCampaignId,
  saving,
  onFormChange,
  onSubmit,
  onEdit,
  onCancelEdit,
  onToggle,
  onPublishStatusChange,
  onViewPlaylist,
  onDelete,
  PlantelSelect,
  PublishStatusBadge,
  InfoPair,
  getCampaignDisplayStatus,
  getCampaignPriorityLabel,
  getPlaylistItemCountLabel,
  normalizeCampaignScheduleForm,
  formatCampaignSchedule,
}) {
  function updateField(field, value) {
    onFormChange({ ...form, [field]: value });
  }

  function updateSchedule(nextSchedule) {
    onFormChange({
      ...form,
      schedule: normalizeCampaignScheduleForm({
        ...form.schedule,
        ...nextSchedule,
      }),
    });
  }

  function toggleDay(day) {
    const currentDays = form.schedule?.daysOfWeek || [];
    const nextDays = currentDays.includes(day)
      ? currentDays.filter((item) => item !== day)
      : [...currentDays, day].sort((a, b) => a - b);

    updateSchedule({ daysOfWeek: nextDays });
  }

  return (
    <div className="signage-main-grid">
      <section className="signage-panel">
        <div className="signage-panel-heading">
          <div>
            <h2>Campañas</h2>
            <p>Vigencia, prioridad y programación semanal de playlists.</p>
          </div>
        </div>

        <div className="signage-campaign-list">
          {campaigns.length === 0 && <p className="digital-empty">Sin campañas registradas. Crea una campaña para programar playlists por fecha y horario.</p>}
          {campaigns.map((campaign) => {
            const playlist = playlists.find((item) => item.id === campaign.playlistId) || null;
            const campaignStatus = getCampaignDisplayStatus(campaign);
            const playlistHasIssue = !playlist || playlist.active === false;

            return (
              <article className={`signage-list-row signage-campaign-card ${playlistHasIssue ? "needs-attention" : ""}`} key={campaign.id}>
                <div className="signage-campaign-main">
                  <div>
                    <strong>{campaign.name || "Campaña sin nombre"}</strong>
                    <span>{campaign.plantel || "Sin plantel"} - {playlist?.name || "Playlist no encontrada"}</span>
                  </div>
                  <div className="signage-health-badges">
                    <span className={`signage-status-badge ${campaignStatus.status}`}>{campaignStatus.label}</span>
                    <PublishStatusBadge status={campaign.publishStatus} />
                    <span className={`signage-priority-badge ${campaign.priority || "normal"}`}>
                      {getCampaignPriorityLabel(campaign.priority)}
                    </span>
                  </div>
                </div>

                <div className="signage-campaign-meta">
                  <InfoPair label="Playlist asignada" value={playlist?.name || "Playlist no encontrada"} strong />
                  <InfoPair label="Contenidos" value={playlist && playlist.active !== false ? getPlaylistItemCountLabel(playlist) : "Sin playlist válida"} />
                  <InfoPair label="Vigencia" value={`${campaign.startDate || "Sin inicio"} a ${campaign.endDate || "Sin fin"}`} />
                  <InfoPair label="Programación" value={formatCampaignSchedule(campaign.schedule)} strong />
                </div>

                {!playlist && (
                  <p className="signage-warning-note">Esta campaña no tiene una playlist válida asignada.</p>
                )}
                {playlist?.active === false && (
                  <p className="signage-warning-note">La playlist asignada está inactiva.</p>
                )}
                {playlist && !isPublished(playlist.publishStatus) && (
                  <p className="signage-warning-note">La playlist asignada no está publicada.</p>
                )}

                <div className="signage-list-actions">
                  <button type="button" className="visual-outline-button" onClick={() => onEdit(campaign)} disabled={saving}>
                    Editar
                  </button>
                  <button type="button" className="visual-outline-button" onClick={() => onViewPlaylist(campaign.playlistId)} disabled={saving || !playlist}>
                    Ver playlist
                  </button>
                  <details className="signage-action-menu">
                    <summary>Más</summary>
                    <div className="signage-action-menu-popover">
                      <button type="button" onClick={() => onToggle(campaign)} disabled={saving}>
                        {campaign.active === false ? "Activar" : "Desactivar"}
                      </button>
                      <label>
                        Publicación
                        <select
                          className="signage-publish-select"
                          value={getPublishStatus(campaign.publishStatus)}
                          onChange={(event) => onPublishStatusChange(campaign, event.target.value)}
                          disabled={saving}
                        >
                          {PUBLISH_STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <button type="button" className="danger" onClick={() => onDelete(campaign)} disabled={saving}>
                        Eliminar
                      </button>
                    </div>
                  </details>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <aside className="signage-side-column">
        <form className="signage-panel" onSubmit={onSubmit}>
          <h3>{editingCampaignId ? "Editar campaña" : "Nueva campaña"}</h3>
          <div className="digital-form-grid">
            <label>
              Nombre
              <input value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="Ej. Promoción matutina" />
            </label>
            <label>
              Plantel
              <PlantelSelect value={form.plantel} onChange={(value) => updateField("plantel", value)} />
            </label>
            <label>
              Playlist
              <select value={form.playlistId} onChange={(event) => updateField("playlistId", event.target.value)}>
                <option value="">Seleccionar playlist</option>
                {playlists.map((playlist) => (
                  <option value={playlist.id} key={playlist.id}>{playlist.name}</option>
                ))}
              </select>
            </label>
            <label>
              Prioridad
              <select value={form.priority} onChange={(event) => updateField("priority", event.target.value)}>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </label>
            <label>
              Publicación
              <select value={getPublishStatus(form.publishStatus)} onChange={(event) => updateField("publishStatus", event.target.value)}>
                {PUBLISH_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              Fecha inicio
              <input type="date" value={form.startDate} onChange={(event) => updateField("startDate", event.target.value)} />
            </label>
            <label>
              Fecha fin
              <input type="date" value={form.endDate} onChange={(event) => updateField("endDate", event.target.value)} />
            </label>
          </div>

          <section className="signage-schedule-box">
            <label className="signage-toggle-row">
              <input
                type="checkbox"
                checked={form.schedule?.enabled === true}
                onChange={(event) => updateSchedule({ enabled: event.target.checked })}
              />
              Usar horario específico
            </label>
            <p className="digital-helper">
              Si no activas esta opción, la campaña se mostrará todo el día durante su vigencia.
            </p>

            {form.schedule?.enabled === true && (
              <>
                <div className="signage-day-picker">
                  {WEEKDAY_OPTIONS.map((day) => (
                    <button
                      key={day.value}
                      type="button"
                      className={form.schedule.daysOfWeek.includes(day.value) ? "active" : ""}
                      onClick={() => toggleDay(day.value)}
                    >
                      {day.short}
                    </button>
                  ))}
                </div>

                <div className="digital-form-grid">
                  <label>
                    Hora inicio
                    <input type="time" value={form.schedule.startTime} onChange={(event) => updateSchedule({ startTime: event.target.value })} />
                  </label>
                  <label>
                    Hora fin
                    <input type="time" value={form.schedule.endTime} onChange={(event) => updateSchedule({ endTime: event.target.value })} />
                  </label>
                  <label>
                    Zona horaria
                    <input value={form.schedule.timezone} readOnly />
                  </label>
                </div>
              </>
            )}
          </section>

          <div className="signage-form-actions">
            {editingCampaignId && (
              <button type="button" className="visual-outline-button" onClick={onCancelEdit}>
                Cancelar edición
              </button>
            )}
            <button type="submit" className="visual-primary-button" disabled={saving}>
              {editingCampaignId ? "Guardar campaña" : "Crear campaña"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
