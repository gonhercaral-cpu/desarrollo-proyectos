import {
  PUBLISH_STATUS_OPTIONS,
  WEEKDAY_OPTIONS,
  DIGITAL_SIGNAGE_PLANTELES,
  getPublishStatus,
  isPublished,
} from "../../utils/digitalSignage";

import { getCampaignPlanteles } from "../../utils/digitalSignage/signageCampaigns";

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

  const plantelOptions = [...new Set([...DIGITAL_SIGNAGE_PLANTELES, ...(form.planteles || [])])];
  const selectedPlanteles = form.planteles || [];
  const allPlantelesSelected = plantelOptions.every((plantel) => selectedPlanteles.includes(plantel));

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
                    <span>{getCampaignPlanteles(campaign).join(", ") || (Array.isArray(campaign.planteles) ? "Sin planteles asignados" : "Todos (campaña anterior)")} - {playlist?.name || "Playlist no encontrada"}</span>
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
        <form className="signage-panel signage-campaign-form" onSubmit={onSubmit}>
          <header className="signage-campaign-form-header">
            <h3>{editingCampaignId ? "Editar campaña" : "Nueva campaña"}</h3>
            <p>Elige el contenido, dónde se mostrará y cuándo estará disponible.</p>
          </header>

          <section className="signage-campaign-form-section" aria-labelledby="campaign-content-title">
            <h4 id="campaign-content-title">Contenido</h4>
            <label className="signage-campaign-field">
              Nombre de la campaña
              <input value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="Ej. Inscripciones 2027" />
            </label>
            <label className="signage-campaign-field">
              Playlist
              <select value={form.playlistId} onChange={(event) => updateField("playlistId", event.target.value)}>
                <option value="">Seleccionar playlist</option>
                {playlists.map((playlist) => (
                  <option value={playlist.id} key={playlist.id}>{playlist.name}</option>
                ))}
              </select>
            </label>
          </section>

          <fieldset className="signage-campaign-form-section signage-campaign-planteles">
            <legend>Planteles</legend>
            <div className="signage-campaign-planteles-toolbar">
              <p>Selecciona dónde se mostrará esta campaña.</p>
              <button type="button" className="signage-campaign-select-all" disabled={saving}
                onClick={() => updateField("planteles", allPlantelesSelected ? [] : [...plantelOptions])}>
                {allPlantelesSelected ? "Limpiar selección" : "Seleccionar todos"}
              </button>
            </div>
            <div className="signage-campaign-planteles-options">
              {plantelOptions.map((plantel) => (
                <label key={plantel} className={`signage-campaign-plantel-option ${selectedPlanteles.includes(plantel) ? "is-selected" : ""}`}>
                  <input type="checkbox" checked={selectedPlanteles.includes(plantel)}
                    onChange={(event) => updateField("planteles", event.target.checked
                      ? [...selectedPlanteles, plantel]
                      : selectedPlanteles.filter((value) => value !== plantel))} />
                  <span>{plantel}</span>
                </label>
              ))}
            </div>
            <p className="signage-campaign-selection-count" role="status">
              {selectedPlanteles.length === 0 ? "Selecciona al menos un plantel."
                : `${selectedPlanteles.length} ${selectedPlanteles.length === 1 ? "plantel seleccionado" : "planteles seleccionados"}`}
            </p>
          </fieldset>

          <section className="signage-campaign-form-section" aria-labelledby="campaign-dates-title">
            <h4 id="campaign-dates-title">Vigencia y horario</h4>
            <div className="signage-campaign-field-pair">
              <label className="signage-campaign-field">
                Fecha inicio
                <input type="date" value={form.startDate} onChange={(event) => updateField("startDate", event.target.value)} />
              </label>
              <label className="signage-campaign-field">
                Fecha fin
                <input type="date" value={form.endDate} onChange={(event) => updateField("endDate", event.target.value)} />
              </label>
            </div>
            <label className="signage-campaign-schedule-toggle">
              <input type="checkbox" checked={form.schedule?.enabled === true}
                onChange={(event) => updateSchedule({ enabled: event.target.checked })} />
              <span>Usar horario específico</span>
            </label>
            <p className="signage-campaign-field-hint">
              {form.schedule?.enabled ? "Elige los días y las horas de reproducción." : "La campaña se mostrará todo el día durante su vigencia."}
            </p>
            {form.schedule?.enabled === true && (
              <div className="signage-campaign-schedule-fields">
                <div className="signage-day-picker" role="group" aria-label="Días de reproducción">
                  {WEEKDAY_OPTIONS.map((day) => (
                    <button key={day.value} type="button" aria-label={day.label}
                      aria-pressed={form.schedule.daysOfWeek.includes(day.value)}
                      className={form.schedule.daysOfWeek.includes(day.value) ? "active" : ""}
                      onClick={() => toggleDay(day.value)}>
                      {day.short}
                    </button>
                  ))}
                </div>
                <div className="signage-campaign-field-pair">
                  <label className="signage-campaign-field">
                    Hora inicio
                    <input type="time" value={form.schedule.startTime} onChange={(event) => updateSchedule({ startTime: event.target.value })} />
                  </label>
                  <label className="signage-campaign-field">
                    Hora fin
                    <input type="time" value={form.schedule.endTime} onChange={(event) => updateSchedule({ endTime: event.target.value })} />
                  </label>
                </div>
                <label className="signage-campaign-field">
                  Zona horaria
                  <input value={form.schedule.timezone} readOnly />
                </label>
              </div>
            )}
          </section>

          <section className="signage-campaign-form-section" aria-labelledby="campaign-publication-title">
            <h4 id="campaign-publication-title">Publicación</h4>
            <div className="signage-campaign-field-pair">
              <label className="signage-campaign-field">
                Prioridad
                <select value={form.priority} onChange={(event) => updateField("priority", event.target.value)}>
                  <option value="normal">Normal</option>
                  <option value="alta">Alta</option>
                  <option value="urgente">Urgente</option>
                </select>
              </label>
              <label className="signage-campaign-field">
                Estado de publicación
                <select value={getPublishStatus(form.publishStatus)} onChange={(event) => updateField("publishStatus", event.target.value)}>
                  {PUBLISH_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <div className="signage-campaign-form-footer">
            {editingCampaignId && (
              <button type="button" className="visual-outline-button" onClick={onCancelEdit} disabled={saving}>
                Cancelar edición
              </button>
            )}
            <button type="submit" className="visual-primary-button" disabled={saving}>
              {saving ? "Guardando…" : editingCampaignId ? "Guardar campaña" : "Crear campaña"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
