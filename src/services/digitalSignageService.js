export {
  logSignageAudit,
  getSignageAuditLogs,
} from "./digital-signage/auditService";

export {
  logPlaybackEvent,
  getPlaybackLogs,
} from "./digital-signage/playbackService";

export {
  uploadSignageAsset,
  createWebAsset,
  importSignageAssetFromDrive,
  createTemplateAsset,
  createVisualAdAsset,
  updateVisualAdAsset,
  getSignageAssets,
  updateSignageAsset,
  sendWebAssetCommand,
  deleteSignageAsset,
  duplicateSignageAsset,
} from "./digital-signage/assetsService";

export {
  createVisualTemplate,
  getVisualTemplates,
  updateVisualTemplate,
  deleteVisualTemplate,
} from "./digital-signage/visualTemplatesService";

export {
  createSignagePlaylist,
  getSignagePlaylists,
  updateSignagePlaylist,
  deleteSignagePlaylist,
  subscribePlaylist,
} from "./digital-signage/playlistsService";

export {
  createSignageCampaign,
  getSignageCampaigns,
  updateSignageCampaign,
  deleteSignageCampaign,
  subscribeSignageCampaigns,
} from "./digital-signage/campaignsService";

export {
  createSignageDevice,
  getSignageDevices,
  updateSignageDevice,
  deleteSignageDevice,
  getDeviceByToken,
  subscribeDeviceByToken,
  updateDeviceHeartbeat,
} from "./digital-signage/devicesService";

export {
  createPairingSession,
  subscribePairingSession,
  updatePairingSessionHeartbeat,
  claimPairingCode,
  expireOldPairingSessions,
} from "./digital-signage/pairingService";

export {
  generateDeviceToken,
  generatePairingCode,
} from "./digital-signage/shared";
