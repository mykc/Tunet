import { useMemo, useCallback, useEffect, useState } from 'react';
import {
  X,
  Bot,
  MapPin,
  Battery,
  Play,
  Pause,
  Home,
  Fan,
  Droplets,
  Sparkles,
  Clock,
  Maximize2,
  Activity,
  Calendar,
  RefreshCw,
  RotateCcw,
  Wrench,
  Minimize2,
} from '../icons';
import ModernDropdown from '../components/ui/ModernDropdown';
import { getRelatedEntityIds, getAreas } from '../services/haClient';
import AccessibleModalShell from '../components/ui/AccessibleModalShell';

const getDisplayName = (entity, fallback) => entity?.attributes?.friendly_name || fallback;

const isValidStateValue = (value) =>
  value != null && value !== '' && value !== 'unavailable' && value !== 'unknown';

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Format a timestamp string to a readable relative or absolute string.
 */
function formatLastCleaned(timestamp, t) {
  if (!timestamp) return '--';
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return String(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t('vacuum.statsJustNow') || 'Just now';
    if (diffMins < 60) return `${diffMins} ${t('vacuum.statsMinutesAgo') || 'min ago'}`;
    if (diffHours < 24) return `${diffHours} ${t('vacuum.statsHoursAgo') || 'h ago'}`;
    if (diffDays < 7) return `${diffDays} ${t('vacuum.statsDaysAgo') || 'd ago'}`;
    return date.toLocaleDateString();
  } catch {
    return String(timestamp);
  }
}

function formatRawValueWithUnit(value, unit) {
  if (value == null || value === '' || value === 'unknown' || value === 'unavailable') return '--';
  const numericValue = Number(value);
  const displayValue = Number.isFinite(numericValue)
    ? Number.isInteger(numericValue)
      ? String(numericValue)
      : String(Number(numericValue.toFixed(1)))
    : String(value);
  if (unit) return `${displayValue} ${unit}`;
  return displayValue;
}

function getVacuumStateLabel(state, battery, t) {
  const normalized = String(state || '').toLowerCase();
  if (!normalized) return t('vacuum.unknown');

  if (normalized === 'cleaning' || normalized === 'vacuuming') return t('vacuum.cleaning');
  if (normalized === 'returning' || normalized === 'going_home' || normalized === 'return_to_base') {
    return t('vacuum.returning') || t('room.vacuumStatus.goingHome') || normalized;
  }
  if ((normalized === 'charging' || normalized === 'docked') && battery === 100) {
    return t('vacuum.docked');
  }
  if (normalized === 'charging' || normalized === 'docked') return t('vacuum.charging');
  if (normalized === 'idle' || normalized === 'ready') return t('vacuum.idle');
  if (normalized === 'paused' || normalized === 'pause') return t('vacuum.pause');
  if (normalized === 'error') return t('room.vacuumStatus.error') || 'Error';
  if (normalized === 'stopped') return t('room.vacuumStatus.stopped') || 'Stopped';
  return state;
}

/**
 * VacuumModal - Modal for vacuum robot information and controls
 */
export default function VacuumModal({
  show,
  onClose,
  entities,
  callService,
  getA,
  t,
  vacuumId,
  vacuumSettings,
  conn,
  getEntityImageUrl,
}) {
  const modalTitleId = `vacuum-modal-title-${(vacuumId || 'vacuum').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  
  // Current room: try attribute first, then find sensor.*current_room
  const roomFromAttr = show && vacuumId ? getA(vacuumId, 'current_room') || getA(vacuumId, 'room') : null;

  // Build helper token arrays to uniquely identify related entities
  const vacuumName = vacuumId ? vacuumId.split('.')[1] || '' : '';
  const vacuumFriendlyName = (vacuumId && entities?.[vacuumId]?.attributes?.friendly_name?.toLowerCase()) || '';
  const vacuumNameTokens = useMemo(() => {
    if (!vacuumName) return [];
    return vacuumName
      .toLowerCase()
      .split(/[_\-\s]+/)
      .filter((token) => token.length > 2)
      .filter((token) => !['vacuum', 'robot', 'cleaner'].includes(token));
  }, [vacuumName]);

  const settings = useMemo(() => vacuumSettings || {}, [vacuumSettings]);
  
  // --- States for HA registries ---
  const [registryRelatedSensorIds, setRegistryRelatedSensorIds] = useState([]);
  const [registryRelatedSelectIds, setRegistryRelatedSelectIds] = useState([]);
  const [registryRelatedButtonIds, setRegistryRelatedButtonIds] = useState([]);
  const [areas, setAreas] = useState([]);
  const [selectedAreaIds, setSelectedAreaIds] = useState([]);
  
  // --- States for UI Tabs and Live Map ---
  const [activeTab, setActiveTab] = useState('controls');
  const [refreshKey, setRefreshKey] = useState(0);
  const [isMapZoomed, setIsMapZoomed] = useState(false);
  const [confirmResetId, setConfirmResetId] = useState(null);

  // Load related sensors
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!show || !vacuumId || !conn) {
        if (!cancelled) setRegistryRelatedSensorIds([]);
        return;
      }
      try {
        const relatedIds = await getRelatedEntityIds(conn, vacuumId, { domains: ['sensor'] });
        if (!cancelled) setRegistryRelatedSensorIds(Array.isArray(relatedIds) ? relatedIds : []);
      } catch {
        if (!cancelled) setRegistryRelatedSensorIds([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [show, vacuumId, conn]);

  // Load related select dropdown controls
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!show || !vacuumId || !conn) {
        if (!cancelled) setRegistryRelatedSelectIds([]);
        return;
      }
      try {
        const relatedIds = await getRelatedEntityIds(conn, vacuumId, {
          domains: ['select', 'input_select'],
        });
        if (!cancelled) setRegistryRelatedSelectIds(Array.isArray(relatedIds) ? relatedIds : []);
      } catch {
        if (!cancelled) setRegistryRelatedSelectIds([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [show, vacuumId, conn]);

  // Load related button entities for consumable resets
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!show || !vacuumId || !conn) {
        if (!cancelled) setRegistryRelatedButtonIds([]);
        return;
      }
      try {
        const relatedIds = await getRelatedEntityIds(conn, vacuumId, { domains: ['button'] });
        if (!cancelled) setRegistryRelatedButtonIds(Array.isArray(relatedIds) ? relatedIds : []);
      } catch {
        if (!cancelled) setRegistryRelatedButtonIds([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [show, vacuumId, conn]);

  // Load HA Area registry
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!show || !conn) {
        if (!cancelled) setAreas([]);
        return;
      }
      try {
        const result = await getAreas(conn);
        if (!cancelled) setAreas(Array.isArray(result) ? result : []);
      } catch {
        if (!cancelled) setAreas([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [show, conn]);

  const getMappedSensorWithUnit = useCallback(
    (settingKey) => {
      const sensorId = settings?.[settingKey];
      if (!sensorId) return null;
      const entity = entities?.[sensorId];
      const value = entity?.state;
      if (!isValidStateValue(value)) return null;
      return {
        value,
        unit: entity?.attributes?.unit_of_measurement || null,
        sensorId,
      };
    },
    [settings, entities]
  );

  const getMappedSensorValue = useCallback(
    (settingKey) => getMappedSensorWithUnit(settingKey)?.value ?? null,
    [getMappedSensorWithUnit]
  );

  const relatedSensors = useMemo(() => {
    if (!entities || !vacuumName) return {};
    const found = {};

    if (registryRelatedSensorIds.length > 0) {
      for (const sensorId of registryRelatedSensorIds) {
        if (!sensorId?.startsWith('sensor.')) continue;
        const sensorEntity = entities[sensorId];
        if (sensorEntity) found[sensorId] = sensorEntity;
      }
      return found;
    }

    for (const [eid, ent] of Object.entries(entities)) {
      if (!eid.startsWith('sensor.')) continue;
      const lowerId = eid.toLowerCase();
      const friendly = (ent?.attributes?.friendly_name || '').toLowerCase();
      const matchesVacuumName = lowerId.includes(vacuumName.toLowerCase());
      const matchesFriendlyName = vacuumFriendlyName && friendly.includes(vacuumFriendlyName);
      const matchesToken = vacuumNameTokens.some(
        (token) => lowerId.includes(token) || friendly.includes(token)
      );

      if (!matchesVacuumName && !matchesFriendlyName && !matchesToken) continue;
      found[eid] = ent;
    }
    return found;
  }, [entities, vacuumName, vacuumFriendlyName, vacuumNameTokens, registryRelatedSensorIds]);

  const findSensorValue = (keywords) => {
    const loweredKeywords = keywords.map((kw) => String(kw).toLowerCase());
    for (const [eid, ent] of Object.entries(relatedSensors)) {
      const haystack = `${eid.toLowerCase()} ${(ent?.attributes?.friendly_name || '').toLowerCase()}`;
      if (loweredKeywords.every((kw) => haystack.includes(kw))) {
        const value = ent?.state;
        if (isValidStateValue(value)) return value;
      }
    }
    return null;
  };

  /** Find a sensor and return { value, unit } */
  const findSensorWithUnit = (keywords) => {
    const loweredKeywords = keywords.map((kw) => String(kw).toLowerCase());
    for (const [eid, ent] of Object.entries(relatedSensors)) {
      const haystack = `${eid.toLowerCase()} ${(ent?.attributes?.friendly_name || '').toLowerCase()}`;
      if (loweredKeywords.every((kw) => haystack.includes(kw))) {
        const value = ent?.state;
        if (isValidStateValue(value)) {
          return { value, unit: ent?.attributes?.unit_of_measurement };
        }
      }
    }
    return null;
  };

  const roomSensorValue = useMemo(() => {
    if (roomFromAttr) return null;
    const mappedRoom = getMappedSensorValue('currentRoomSensorId');
    if (mappedRoom) return mappedRoom;
    if (!entities || !vacuumId) return null;
    for (const [eid, ent] of Object.entries(entities)) {
      if (
        eid.startsWith('sensor.') &&
        eid.includes('current_room') &&
        (eid.includes(vacuumName) || eid.includes('roborock') || eid.includes('vacuum'))
      ) {
        return isValidStateValue(ent?.state) ? ent.state : null;
      }
    }
    return null;
  }, [entities, vacuumId, roomFromAttr, vacuumName, getMappedSensorValue]);

  const room = roomFromAttr || roomSensorValue;
  const roomScripts = useMemo(
    () =>
      Array.isArray(settings.roomScripts) ? settings.roomScripts.filter((script) => script.entityId) : [],
    [settings.roomScripts]
  );

  // --- Dynamic consumables auto-detection ---
  const findConsumableSensor = useCallback(
    (keywords) => {
      const loweredKeywords = keywords.map((kw) => kw.toLowerCase());
      if (registryRelatedSensorIds.length > 0) {
        const found = registryRelatedSensorIds.find((eid) => {
          const lowerEid = eid.toLowerCase();
          const friendly = (entities?.[eid]?.attributes?.friendly_name || '').toLowerCase();
          const haystack = `${lowerEid} ${friendly}`;
          return loweredKeywords.every((kw) => haystack.includes(kw));
        });
        if (found) return found;
      }
      return Object.keys(entities || {}).find((eid) => {
        if (!eid.startsWith('sensor.')) return false;
        const lowerEid = eid.toLowerCase();
        const isRelated =
          vacuumNameTokens.length === 0 ||
          vacuumNameTokens.some((token) => lowerEid.includes(token)) ||
          lowerEid.includes(vacuumName.toLowerCase());
        if (!isRelated) return false;
        const friendly = (entities[eid]?.attributes?.friendly_name || '').toLowerCase();
        const haystack = `${lowerEid} ${friendly}`;
        return loweredKeywords.every((kw) => haystack.includes(kw));
      });
    },
    [entities, registryRelatedSensorIds, vacuumName, vacuumNameTokens]
  );

  const findConsumableButton = useCallback(
    (keywords) => {
      const loweredKeywords = keywords.map((kw) => kw.toLowerCase());
      if (registryRelatedButtonIds.length > 0) {
        const found = registryRelatedButtonIds.find((eid) => {
          const lowerEid = eid.toLowerCase();
          const friendly = (entities?.[eid]?.attributes?.friendly_name || '').toLowerCase();
          const haystack = `${lowerEid} ${friendly}`;
          return loweredKeywords.every((kw) => haystack.includes(kw));
        });
        if (found) return found;
      }
      return Object.keys(entities || {}).find((eid) => {
        if (!eid.startsWith('button.')) return false;
        const lowerEid = eid.toLowerCase();
        const isRelated =
          vacuumNameTokens.length === 0 ||
          vacuumNameTokens.some((token) => lowerEid.includes(token)) ||
          lowerEid.includes(vacuumName.toLowerCase());
        if (!isRelated) return false;
        const friendly = (entities[eid]?.attributes?.friendly_name || '').toLowerCase();
        const haystack = `${lowerEid} ${friendly}`;
        return loweredKeywords.every((kw) => haystack.includes(kw));
      });
    },
    [entities, registryRelatedButtonIds, vacuumName, vacuumNameTokens]
  );

  const consumables = useMemo(() => {
    if (!show || !vacuumId || !entities) return [];
    
    const items = [
      {
        key: 'mainBrush',
        label: t('vacuum.mainBrush') || 'Main Brush',
        sensorId: findConsumableSensor(['main', 'brush']),
        buttonId: findConsumableButton(['main', 'brush', 'reset']),
        icon: Wrench,
      },
      {
        key: 'sideBrush',
        label: t('vacuum.sideBrush') || 'Side Brush',
        sensorId: findConsumableSensor(['side', 'brush']),
        buttonId: findConsumableButton(['side', 'brush', 'reset']),
        icon: RotateCcw,
      },
      {
        key: 'filter',
        label: t('vacuum.filter') || 'Filter',
        sensorId: findConsumableSensor(['filter']),
        buttonId: findConsumableButton(['filter', 'reset']),
        icon: Fan,
      },
      {
        key: 'sensors',
        label: t('vacuum.sensors') || 'Sensors',
        sensorId:
          findConsumableSensor(['sensor', 'dirty']) ||
          findConsumableSensor(['sensor', 'cleaning']) ||
          findConsumableSensor(['sensor', 'wear']) ||
          findConsumableSensor(['sensors', 'dirty']),
        buttonId:
          findConsumableButton(['sensor', 'reset']) ||
          findConsumableButton(['sensors', 'reset']) ||
          findConsumableButton(['sensor_dirty', 'reset']),
        icon: Sparkles,
      },
    ];

    return items
      .map((item) => {
        const stateVal = entities[item.sensorId]?.state;
        const pct = toFiniteNumber(stateVal);
        return { ...item, pct };
      })
      .filter((item) => item.pct !== null);
  }, [show, vacuumId, entities, findConsumableSensor, findConsumableButton, t]);

  // --- Live Map auto-detection ---
  const mapImageEntityId = useMemo(() => {
    if (settings?.mapImageEntityId) return settings.mapImageEntityId;
    if (!entities || !vacuumName) return null;
    return Object.keys(entities).find((eid) => {
      if (!eid.startsWith('image.')) return false;
      const lowerEid = eid.toLowerCase();
      const isRelated =
        vacuumNameTokens.length === 0 ||
        vacuumNameTokens.some((token) => lowerEid.includes(token)) ||
        lowerEid.includes(vacuumName.toLowerCase());
      if (!isRelated) return false;
      const friendly = (entities[eid]?.attributes?.friendly_name || '').toLowerCase();
      return lowerEid.includes('map') || friendly.includes('map');
    });
  }, [settings?.mapImageEntityId, entities, vacuumName, vacuumNameTokens]);

  const mapUrl = useMemo(() => {
    if (!mapImageEntityId || !entities?.[mapImageEntityId] || typeof getEntityImageUrl !== 'function') {
      return null;
    }
    const picture = entities[mapImageEntityId]?.attributes?.entity_picture;
    return picture ? getEntityImageUrl(picture) : null;
  }, [mapImageEntityId, entities, getEntityImageUrl]);

  const finalMapUrl = useMemo(() => {
    if (!mapUrl) return null;
    return `${mapUrl}${mapUrl.includes('?') ? '&' : '?'}t=${refreshKey}`;
  }, [mapUrl, refreshKey]);

  // Determine Tab layout eligibility
  const hasMap = !!mapImageEntityId;
  const hasAreas = areas.length > 0;
  const hasMaintenance = consumables.length > 0;
  const showTabbedLayout = hasMap || hasAreas || hasMaintenance;

  // Reset tab to controls if layout is closed/opened
  useEffect(() => {
    if (show) {
      setActiveTab('controls');
      setSelectedAreaIds([]);
      setConfirmResetId(null);
    }
  }, [show]);

  if (!show) return null;
  if (!vacuumId || !entities?.[vacuumId]) return null;

  const entity = entities[vacuumId];
  const attrs = entity?.attributes || {};
  const state = entity?.state;
  const isCleaning = state === 'cleaning';
  const isReturning = state === 'returning';
  const isError = state === 'error';
  const supportedFeatures = Number(attrs.supported_features);
  const hasSupportedFeatures = Number.isFinite(supportedFeatures) && supportedFeatures > 0;
  const hasAnyFeature = (bits) =>
    hasSupportedFeatures && bits.some((bit) => (supportedFeatures & bit) === bit);

  const battery = toFiniteNumber(
    getA(vacuumId, 'battery_level') ??
      getMappedSensorValue('batterySensorId') ??
      findSensorValue(['battery_level']) ??
      findSensorValue(['battery']) ??
      findSensorValue(['soc'])
  );
  
  const fanSpeed = getA(vacuumId, 'fan_speed');
  const mopIntensity = getA(vacuumId, 'mop_intensity');
  const mopControlEntityId = (() => {
    const mapped = settings?.mopIntensityControlEntityId;
    if (mapped && entities?.[mapped]) return mapped;
    if (!Array.isArray(registryRelatedSelectIds) || registryRelatedSelectIds.length === 0) return null;

    const keywordRegex = /(mop|water|intensity|wet|scrub)/i;
    const match = registryRelatedSelectIds.find((entityId) => {
      const lowerId = String(entityId).toLowerCase();
      const friendly = String(entities?.[entityId]?.attributes?.friendly_name || '').toLowerCase();
      return keywordRegex.test(lowerId) || keywordRegex.test(friendly);
    });

    return match || null;
  })();
  
  const mopControlEntity = mopControlEntityId ? entities?.[mopControlEntityId] : null;
  const mopControlOptions = Array.isArray(mopControlEntity?.attributes?.options)
    ? mopControlEntity.attributes.options
    : [];
  const mopControlCurrent = mopControlEntity?.state;
  const canPause = hasAnyFeature([2, 4]) || !hasSupportedFeatures;
  const canStop = hasAnyFeature([4, 8]) || !hasSupportedFeatures;
  const canReturnToBase = hasAnyFeature([8, 16]) || !hasSupportedFeatures;
  const canLocate = hasAnyFeature([64, 256, 1024]) || !hasSupportedFeatures;
  const hasFanControls =
    (Array.isArray(attrs.fan_speed_list) && attrs.fan_speed_list.length > 0) ||
    isValidStateValue(fanSpeed);
  const canSetFanSpeed = hasFanControls || hasAnyFeature([16, 32]);
  const hasMopControls =
    (Array.isArray(attrs.mop_intensity_list) && attrs.mop_intensity_list.length > 0) ||
    isValidStateValue(mopIntensity) ||
    mopControlOptions.length > 0 ||
    Object.keys(attrs).some((key) => key.startsWith('mop_') || key.startsWith('water_'));
  const canSetMopIntensity = hasMopControls;

  // --- Cleaning statistics ---
  const mappedCleaningTime = getMappedSensorWithUnit('cleaningTimeSensorId');
  const cleaningTimeRaw =
    mappedCleaningTime?.value ?? attrs.cleaning_time ?? attrs.current_clean_time ?? attrs.clean_time ?? null;
  const cleaningTimeSensor =
    cleaningTimeRaw == null
      ? (findSensorWithUnit(['cleaning_time']) ?? findSensorWithUnit(['clean_time']))
      : null;
  const cleaningTime = cleaningTimeRaw ?? cleaningTimeSensor?.value ?? null;
  const cleaningTimeUnit = mappedCleaningTime?.unit ?? cleaningTimeSensor?.unit ?? null;

  const mappedCleanedArea = getMappedSensorWithUnit('cleanedAreaSensorId');
  const cleanedAreaRaw =
    mappedCleanedArea?.value ?? attrs.cleaned_area ?? attrs.current_clean_area ?? attrs.clean_area ?? null;
  const cleanedAreaSensor =
    cleanedAreaRaw == null
      ? (findSensorWithUnit(['cleaning_area']) ??
        findSensorWithUnit(['cleaned_area']) ??
        findSensorWithUnit(['clean_area']))
      : null;
  const cleanedArea = cleanedAreaRaw ?? cleanedAreaSensor?.value ?? null;
  const cleanedAreaUnit =
    mappedCleanedArea?.unit ??
    cleanedAreaSensor?.unit ??
    attrs.cleaned_area_unit ??
    attrs.current_clean_area_unit ??
    attrs.clean_area_unit ??
    null;

  const mappedTotalCleanTime = getMappedSensorWithUnit('totalCleanTimeSensorId');
  const totalTimeRaw =
    mappedTotalCleanTime?.value ??
    attrs.total_cleaning_time ??
    attrs.total_clean_time ??
    attrs.total_duration ??
    null;
  const totalTimeSensor =
    totalTimeRaw == null
      ? (findSensorWithUnit(['total', 'cleaning_time']) ??
        findSensorWithUnit(['total', 'clean_time']) ??
        findSensorWithUnit(['total', 'duration']))
      : null;
  const totalCleanTime = totalTimeRaw ?? totalTimeSensor?.value ?? null;
  const totalCleanTimeUnit = mappedTotalCleanTime?.unit ?? totalTimeSensor?.unit ?? null;

  const mappedTotalCleanArea = getMappedSensorWithUnit('totalCleanAreaSensorId');
  const totalCleanAreaRaw =
    mappedTotalCleanArea?.value ?? attrs.total_clean_area ?? attrs.total_cleaned_area ?? null;
  const totalCleanAreaSensor =
    totalCleanAreaRaw == null
      ? (findSensorWithUnit(['total', 'clean_area']) ??
        findSensorWithUnit(['total', 'cleaned_area']))
      : null;
  const totalCleanArea = totalCleanAreaRaw ?? totalCleanAreaSensor?.value ?? null;
  const totalCleanAreaUnit =
    mappedTotalCleanArea?.unit ??
    totalCleanAreaSensor?.unit ??
    attrs.total_clean_area_unit ??
    attrs.total_cleaned_area_unit ??
    null;

  const totalCleanCount =
    getMappedSensorValue('totalCleanCountSensorId') ??
    attrs.total_clean_count ??
    attrs.clean_count ??
    findSensorValue(['total', 'clean_count']) ??
    findSensorValue(['clean_count']);
    
  const lastCleanStart =
    getMappedSensorValue('lastCleanStartSensorId') ??
    attrs.last_clean_start ??
    attrs.last_run_start ??
    findSensorValue(['last_clean_start']) ??
    findSensorValue(['last_run_start']);
    
  const lastCleanEnd =
    getMappedSensorValue('lastCleanEndSensorId') ??
    attrs.last_clean_end ??
    attrs.last_run_end ??
    findSensorValue(['last_clean_end']) ??
    findSensorValue(['last_run_end']) ??
    findSensorValue(['last_clean_time']);

  const startRoomCleaning = async (scriptEntityId) => {
    if (!conn && !callService) return;
    try {
      if (conn) {
        await conn.sendMessagePromise({
          type: 'call_service',
          domain: 'script',
          service: 'turn_on',
          service_data: { entity_id: scriptEntityId },
        });
      } else {
        callService('script', 'turn_on', { entity_id: scriptEntityId });
      }
    } catch (_e) {
      // silently handle
    }
  };

  const fanSpeedList =
    Array.isArray(attrs.fan_speed_list) && attrs.fan_speed_list.length > 0
      ? attrs.fan_speed_list
      : ['Silent', 'Standard', 'Strong', 'Turbo'];
  
  const mopIntensityList =
    Array.isArray(attrs.mop_intensity_list) && attrs.mop_intensity_list.length > 0
      ? attrs.mop_intensity_list
      : ['Low', 'Medium', 'High'];
      
  const effectiveMopOptions = mopControlOptions.length > 0 ? mopControlOptions : mopIntensityList;
  const effectiveMopCurrent = mopControlOptions.length > 0 ? mopControlCurrent : mopIntensity;

  const setMopIntensity = (value) => {
    if (mopControlEntityId && mopControlOptions.length > 0) {
      const domain = mopControlEntityId.split('.')[0];
      if (domain === 'select' || domain === 'input_select') {
        callService(domain, 'select_option', {
          entity_id: mopControlEntityId,
          option: value,
        });
        return;
      }
    }
    callService('vacuum', 'set_mop_intensity', {
      entity_id: vacuumId,
      mop_intensity: value,
    });
  };

  const handlePrimaryAction = () => {
    if (isCleaning) {
      if (canPause) {
        callService('vacuum', 'pause', { entity_id: vacuumId });
        return;
      }
      if (canStop) {
        callService('vacuum', 'stop', { entity_id: vacuumId });
        return;
      }
    }
    callService('vacuum', 'start', { entity_id: vacuumId });
  };

  const primaryActionLabel = isCleaning
    ? canPause
      ? t('vacuum.pause')
      : t('vacuum.stop') || 'Stop'
    : t('vacuum.start');

  const statusColor = isCleaning
    ? '#60a5fa'
    : isReturning
      ? '#c084fc'
      : isError
        ? '#ef4444'
        : 'var(--text-secondary)';
        
  const statusBg = isCleaning
    ? 'rgba(59, 130, 246, 0.1)'
    : isReturning
      ? 'rgba(192, 132, 252, 0.1)'
      : isError
        ? 'rgba(239, 68, 68, 0.1)'
        : 'var(--glass-bg)';
        
  const stateLabel = getVacuumStateLabel(state, battery, t);

  // Consumable reset trigger
  const handleReset = async (buttonId, key) => {
    if (!buttonId || !conn) return;
    try {
      await conn.sendMessagePromise({
        type: 'call_service',
        domain: 'button',
        service: 'press',
        service_data: {
          entity_id: buttonId,
        },
      });
      setConfirmResetId(null);
    } catch (err) {
      console.error('Error resetting consumable:', err);
    }
  };

  const getConsumableColor = (val) => {
    if (val === null) return 'var(--text-muted)';
    if (val < 20) return 'hsl(346, 84%, 61%)'; // Red
    if (val <= 50) return 'hsl(38, 92%, 50%)'; // Amber
    return 'hsl(142, 70%, 45%)'; // Green
  };

  // Trigger Area Cleaning service
  const handleCleanSelectedAreas = async () => {
    if (selectedAreaIds.length === 0 || !conn) return;
    try {
      await conn.sendMessagePromise({
        type: 'call_service',
        domain: 'vacuum',
        service: 'clean_area',
        service_data: {
          entity_id: vacuumId,
          area_id: selectedAreaIds,
        },
      });
      setSelectedAreaIds([]);
      setActiveTab('controls');
    } catch (err) {
      console.error('Error in area cleaning service call:', err);
    }
  };

  // Render original split controls (used directly or as the Control Tab)
  const renderControlsPane = (showRightImage = true) => {
    return (
      <div className="grid grid-cols-1 items-start gap-12 font-sans lg:grid-cols-5">
        {/* Left Column - Main Controls & Status (Span 3) */}
        <div className="space-y-6 lg:col-span-3">
          <div className="popup-surface flex flex-col items-center justify-center gap-8 rounded-3xl p-8">
            {/* Primary Actions */}
            <div className="flex w-full gap-4">
              <button
                onClick={handlePrimaryAction}
                className={`flex flex-1 items-center justify-center gap-3 rounded-2xl py-5 text-sm font-bold tracking-widest uppercase transition-all active:scale-[0.98] ${
                  isCleaning ? 'hover:bg-[var(--glass-bg-hover)]' : 'hover:opacity-90'
                }`}
                style={
                  isCleaning
                    ? { backgroundColor: 'var(--glass-bg)', color: 'var(--text-primary)' }
                    : { backgroundColor: 'var(--accent-color)', color: '#fff' }
                }
              >
                {isCleaning ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                {primaryActionLabel}
              </button>
              {canReturnToBase && (
                <button
                  onClick={() => callService('vacuum', 'return_to_base', { entity_id: vacuumId })}
                  className="flex flex-1 items-center justify-center gap-3 rounded-2xl py-5 text-sm font-bold tracking-widest uppercase transition-all hover:bg-[var(--glass-bg-hover)] active:scale-[0.98]"
                  style={{ backgroundColor: 'var(--glass-bg)', color: 'var(--text-primary)' }}
                >
                  <Home className="h-5 w-5" />
                  {t('vacuum.home')}
                </button>
              )}
            </div>

            {/* Secondary Status Grid */}
            <div className={`grid w-full gap-4 ${canLocate ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {/* Battery */}
              <div
                className="flex flex-col items-center gap-2 rounded-2xl p-4 transition-all"
                style={{ backgroundColor: 'var(--glass-bg)' }}
              >
                <Battery
                  className={`h-6 w-6 ${
                    battery != null && battery < 20 ? 'text-[var(--status-error-fg)]' : 'text-[var(--status-success-fg)]'
                  }`}
                />
                <span className="text-xl font-light">
                  {battery != null ? `${Math.round(battery)}%` : '--'}
                </span>
                <span
                  className="text-[10px] font-bold tracking-widest uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t('vacuum.battery')}
                </span>
              </div>

              {/* Room */}
              <div
                className="flex flex-col items-center gap-2 rounded-2xl p-4 transition-all"
                style={{ backgroundColor: 'var(--glass-bg)' }}
              >
                <MapPin className="h-6 w-6" style={{ color: 'var(--accent-color)' }} />
                <span className="max-w-full truncate px-2 text-xl font-light" title={room}>
                  {room || '--'}
                </span>
                <span
                  className="text-[10px] font-bold tracking-widest uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t('vacuum.room')}
                </span>
              </div>

              {/* Locate Button */}
              {canLocate && (
                <button
                  onClick={() => callService('vacuum', 'locate', { entity_id: vacuumId })}
                  className="group flex flex-col items-center gap-2 rounded-2xl p-4 transition-all hover:bg-[var(--glass-bg-hover)] active:scale-[0.98]"
                  style={{ backgroundColor: 'var(--glass-bg)' }}
                >
                  <Bot className="h-6 w-6 text-purple-400" />
                  <span className="text-xl font-light">{t('vacuum.find')}</span>
                  <span
                    className="text-[10px] font-bold tracking-widest uppercase opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Click
                  </span>
                </button>
              )}
            </div>

            {/* Current Session Stats */}
            <div className="w-full space-y-3">
              <p
                className="text-[10px] font-bold tracking-widest uppercase"
                style={{ color: 'var(--text-muted)' }}
              >
                {t('vacuum.statsCurrentSession') || 'Current session'}
              </p>
              <div className="grid w-full grid-cols-2 gap-3">
                <div
                  className="flex items-center gap-3 rounded-2xl px-4 py-3 transition-all"
                  style={{ backgroundColor: 'var(--glass-bg)' }}
                >
                  <div
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
                    style={{
                      backgroundColor: isCleaning ? 'rgba(59, 130, 246, 0.15)' : 'var(--glass-bg)',
                      color: isCleaning ? '#60a5fa' : 'var(--text-secondary)',
                    }}
                  >
                    <Clock className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-lg leading-tight font-light">
                      {formatRawValueWithUnit(cleaningTime, cleaningTimeUnit)}
                    </p>
                    <p
                      className="text-[10px] font-bold tracking-widest uppercase"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {t('vacuum.statsTime') || 'Time'}
                    </p>
                  </div>
                </div>
                <div
                  className="flex items-center gap-3 rounded-2xl px-4 py-3 transition-all"
                  style={{ backgroundColor: 'var(--glass-bg)' }}
                >
                  <div
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
                    style={{
                      backgroundColor: isCleaning ? 'rgba(59, 130, 246, 0.15)' : 'var(--glass-bg)',
                      color: isCleaning ? '#60a5fa' : 'var(--text-secondary)',
                    }}
                  >
                    <Maximize2 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-lg leading-tight font-light">
                      {formatRawValueWithUnit(cleanedArea, cleanedAreaUnit)}
                    </p>
                    <p
                      className="text-[10px] font-bold tracking-widest uppercase"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {t('vacuum.statsArea') || 'Area'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Room Scripts */}
            {roomScripts.length > 0 && (
              <div className="w-full space-y-3">
                <p
                  className="text-[10px] font-bold tracking-widest uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t('vacuum.cleanRooms') || 'Clean rooms'}
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {roomScripts.map((script, index) => (
                    <button
                      key={index}
                      onClick={() => startRoomCleaning(script.entityId)}
                      className="group flex items-center justify-center gap-2 rounded-2xl px-4 py-4 text-sm font-medium transition-all hover:bg-[var(--glass-bg-hover)] active:scale-[0.98]"
                      style={{
                        backgroundColor: 'var(--glass-bg)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <Sparkles
                        className="h-4 w-4 transition-colors"
                        style={{ color: 'var(--text-secondary)' }}
                      />
                      {script.label || script.entityId}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column - Modes/Settings & Map if available (Span 2) */}
        <div className="flex flex-col justify-start space-y-6 py-2 font-sans lg:col-span-2">
          {/* Live Map Display in controls column */}
          {showRightImage && finalMapUrl && (
            <div className="relative aspect-square w-full overflow-hidden rounded-3xl border border-[var(--glass-border)] bg-zinc-950/40 p-2 shadow-2xl backdrop-blur-md">
              {/* Pulsing Live Badge */}
              <div className="absolute top-4 left-4 z-10 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-[10px] font-bold tracking-widest text-emerald-400 uppercase italic shadow-md backdrop-blur-md">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                </span>
                {t('vacuum.liveMap') || 'Live Map'}
              </div>

              {/* Map Button Toolbar */}
              <div className="absolute top-4 right-4 z-10 flex gap-2">
                <button
                  onClick={() => setRefreshKey((prev) => prev + 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white border border-white/10 hover:bg-black/80 transition-all hover:scale-105"
                  title={t('vacuum.reloadMap') || 'Reload map'}
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setIsMapZoomed(true)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white border border-white/10 hover:bg-black/80 transition-all hover:scale-105"
                  title="Maximize Map"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>

              <img
                src={finalMapUrl}
                alt="Live Map"
                className="h-full w-full object-contain rounded-2xl transition-opacity duration-300"
                style={{ filter: 'drop-shadow(0 10px 15px rgba(0,0,0,0.5))' }}
              />
            </div>
          )}

          {canSetFanSpeed && (
            <ModernDropdown
              label={t('vacuum.suction')}
              icon={Fan}
              options={fanSpeedList}
              current={fanSpeed}
              onChange={(value) =>
                callService('vacuum', 'set_fan_speed', { entity_id: vacuumId, fan_speed: value })
              }
              placeholder={t('vacuum.suction')}
              map={{}}
            />
          )}

          {canSetMopIntensity && (
            <ModernDropdown
              label={t('vacuum.mopIntensity')}
              icon={Droplets}
              options={effectiveMopOptions}
              current={effectiveMopCurrent}
              onChange={setMopIntensity}
              placeholder={t('vacuum.mopIntensity')}
              map={{}}
            />
          )}

          {/* If simple layout, show history stats directly on right pane */}
          {!showTabbedLayout && renderHistoryCard()}
        </div>
      </div>
    );
  };

  function renderHistoryCard() {
    return (
      <div className="not-italic">
        <p
          className="mb-3 ml-1 text-xs font-bold uppercase"
          style={{ color: 'var(--text-muted)', letterSpacing: '0.2em' }}
        >
          {t('vacuum.statsHistory') || 'History'}
        </p>
        <div
          className="space-y-0 overflow-hidden rounded-2xl"
          style={{
            background: 'var(--modal-surface, var(--glass-bg))',
            boxShadow: 'var(--modal-surface-shadow, 0 10px 24px rgba(0,0,0,0.25))',
          }}
        >
          <div
            className="flex items-center gap-3 border-b px-5 py-3.5"
            style={{ borderColor: 'var(--glass-border)' }}
          >
            <Activity className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--accent-color)' }} />
            <span
              className="flex-1 text-xs font-bold tracking-widest uppercase"
              style={{ color: 'var(--text-secondary)' }}
            >
              {t('vacuum.statsTotalCleans') || 'Total cleans'}
            </span>
            <span className="text-sm font-light" style={{ color: 'var(--text-primary)' }}>
              {totalCleanCount ?? '--'}
            </span>
          </div>
          <div
            className="flex items-center gap-3 border-b px-5 py-3.5"
            style={{ borderColor: 'var(--glass-border)' }}
          >
            <Clock className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--accent-color)' }} />
            <span
              className="flex-1 text-xs font-bold tracking-widest uppercase"
              style={{ color: 'var(--text-secondary)' }}
            >
              {t('vacuum.statsTotalTime') || 'Total time'}
            </span>
            <span className="text-sm font-light" style={{ color: 'var(--text-primary)' }}>
              {formatRawValueWithUnit(totalCleanTime, totalCleanTimeUnit)}
            </span>
          </div>
          <div
            className="flex items-center gap-3 border-b px-5 py-3.5"
            style={{ borderColor: 'var(--glass-border)' }}
          >
            <Maximize2 className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--accent-color)' }} />
            <span
              className="flex-1 text-xs font-bold tracking-widest uppercase"
              style={{ color: 'var(--text-secondary)' }}
            >
              {t('vacuum.statsTotalArea') || 'Total area'}
            </span>
            <span className="text-sm font-light" style={{ color: 'var(--text-primary)' }}>
              {formatRawValueWithUnit(totalCleanArea, totalCleanAreaUnit)}
            </span>
          </div>
          <div className="flex items-center gap-3 px-5 py-3.5">
            <Calendar className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--accent-color)' }} />
            <span
              className="flex-1 text-xs font-bold tracking-widest uppercase"
              style={{ color: 'var(--text-secondary)' }}
            >
              {t('vacuum.lastCleaned')}
            </span>
            <span className="text-sm font-light" style={{ color: 'var(--text-primary)' }}>
              {formatLastCleaned(lastCleanEnd || lastCleanStart, t)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AccessibleModalShell
      open={show && !!vacuumId && !!entities?.[vacuumId]}
      onClose={onClose}
      titleId={modalTitleId}
      overlayClassName="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6"
      overlayStyle={{ backdropFilter: 'blur(20px)', backgroundColor: 'rgba(0,0,0,0.3)' }}
      panelClassName="popup-anim relative max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-3xl border p-6 font-sans backdrop-blur-xl md:rounded-[3rem] md:p-12"
      panelStyle={{
        background: 'linear-gradient(135deg, var(--card-bg) 0%, var(--modal-bg) 100%)',
        borderColor: 'var(--glass-border)',
        color: 'var(--text-primary)',
      }}
    >
      {() => (
        <>
          <button
            onClick={onClose}
            className="modal-close absolute top-6 right-6 md:top-10 md:right-10"
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>

          {/* Header Section */}
          <div className="mb-6 flex items-center gap-4 font-sans">
            <div
              className="rounded-2xl p-4 transition-all duration-500"
              style={{ backgroundColor: statusBg, color: statusColor }}
            >
              <Bot className={`h-8 w-8${isCleaning ? ' animate-pulse' : ''}`} />
            </div>
            <div>
              <h3
                id={modalTitleId}
                className="text-2xl leading-none font-light tracking-tight uppercase italic"
                style={{ color: 'var(--text-primary)' }}
              >
                {getDisplayName(entity, vacuumId)}
              </h3>
              <div
                className="mt-2 inline-block rounded-full px-3 py-1 transition-all duration-500"
                style={{ backgroundColor: statusBg, color: statusColor }}
              >
                <p className="text-[10px] font-bold tracking-widest uppercase italic">
                  {t('status.statusLabel')}: {stateLabel}
                </p>
              </div>
            </div>
          </div>

          {/* Premium Tab Bar for Map / Area Cleaning / Maintenance */}
          {showTabbedLayout && (
            <div className="mb-8 flex flex-wrap gap-2 rounded-2xl bg-[var(--glass-bg)] border border-[var(--glass-border)] p-1.5 w-fit">
              <button
                onClick={() => setActiveTab('controls')}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold tracking-widest uppercase transition-all duration-300 active:scale-[0.98] ${
                  activeTab === 'controls'
                    ? 'bg-[var(--accent-color)] text-white shadow-lg shadow-[rgba(var(--accent-color-rgb),0.2)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Bot className="h-4 w-4" />
                {t('vacuum.controls') || 'Controls'}
              </button>

              {hasAreas && (
                <button
                  onClick={() => setActiveTab('areas')}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold tracking-widest uppercase transition-all duration-300 active:scale-[0.98] ${
                    activeTab === 'areas'
                      ? 'bg-[var(--accent-color)] text-white shadow-lg shadow-[rgba(var(--accent-color-rgb),0.2)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <MapPin className="h-4 w-4" />
                  {t('vacuum.cleanAreas') || 'Area Cleaning'}
                </button>
              )}

              {hasMaintenance && (
                <button
                  onClick={() => setActiveTab('maintenance')}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold tracking-widest uppercase transition-all duration-300 active:scale-[0.98] ${
                    activeTab === 'maintenance'
                      ? 'bg-[var(--accent-color)] text-white shadow-lg shadow-[rgba(var(--accent-color-rgb),0.2)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Wrench className="h-4 w-4" />
                  {t('vacuum.maintenance') || 'Maintenance'}
                </button>
              )}

              <button
                onClick={() => setActiveTab('history')}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold tracking-widest uppercase transition-all duration-300 active:scale-[0.98] ${
                  activeTab === 'history'
                    ? 'bg-[var(--accent-color)] text-white shadow-lg shadow-[rgba(var(--accent-color-rgb),0.2)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Activity className="h-4 w-4" />
                {t('vacuum.statsHistory') || 'History'}
              </button>
            </div>
          )}

          {/* Render Tab Contents */}
          {(!showTabbedLayout || activeTab === 'controls') && renderControlsPane(hasMap)}

          {showTabbedLayout && activeTab === 'areas' && (
            <div className="animate-in fade-in duration-300">
              <div className="mb-6">
                <h4 className="text-lg font-light tracking-wide text-[var(--text-primary)]">
                  {t('vacuum.cleanAreas') || 'Area Cleaning'}
                </h4>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {t('vacuum.selectAreas') || 'Select areas to clean'}
                </p>
              </div>

              {areas.length > 0 ? (
                <>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {areas.map((area) => {
                      const isSelected = selectedAreaIds.includes(area.area_id);
                      return (
                        <button
                          key={area.area_id}
                          onClick={() => {
                            setSelectedAreaIds((prev) =>
                              prev.includes(area.area_id)
                                ? prev.filter((id) => id !== area.area_id)
                                : [...prev, area.area_id]
                            );
                          }}
                          className={`group relative flex flex-col items-center justify-center gap-3 rounded-2xl border p-6 transition-all duration-300 active:scale-95 ${
                            isSelected
                              ? 'border-[var(--accent-color)] bg-[var(--accent-bg)] text-[var(--accent-color)] shadow-[0_0_15px_rgba(96,165,250,0.1)]'
                              : 'border-[var(--glass-border)] bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-950/20 text-[var(--text-muted)] transition-all group-hover:scale-110">
                            <MapPin className={`h-5 w-5 ${isSelected ? 'text-[var(--accent-color)]' : ''}`} />
                          </div>
                          <span className="text-sm font-semibold truncate max-w-full">
                            {area.name || area.area_id}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-8 flex justify-center">
                    <button
                      disabled={selectedAreaIds.length === 0}
                      onClick={handleCleanSelectedAreas}
                      className={`flex items-center gap-3 rounded-2xl px-8 py-4 text-sm font-bold tracking-widest uppercase transition-all active:scale-[0.98] ${
                        selectedAreaIds.length === 0
                          ? 'opacity-40 cursor-not-allowed bg-[var(--glass-bg)] text-[var(--text-muted)] border border-[var(--glass-border)]'
                          : 'bg-[var(--accent-color)] hover:opacity-90 text-white shadow-lg'
                      }`}
                    >
                      <Play className="h-5 w-5" />
                      {t('vacuum.cleanSelected') || 'Clean Selected Areas'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex min-h-[30vh] flex-col items-center justify-center text-center">
                  <MapPin className="mb-4 h-12 w-12 text-[var(--text-muted)] opacity-30 animate-pulse" />
                  <p className="text-sm text-[var(--text-secondary)]">
                    {t('vacuum.noAreasMapped') || 'No areas mapped in Home Assistant'}
                  </p>
                </div>
              )}
            </div>
          )}

          {showTabbedLayout && activeTab === 'maintenance' && (
            <div className="animate-in fade-in duration-300">
              <div className="mb-6">
                <h4 className="text-lg font-light tracking-wide text-[var(--text-primary)]">
                  {t('vacuum.maintenance') || 'Maintenance'}
                </h4>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {t('vacuum.maintenanceDesc') || 'Consumables lifetime and sensor cleaning status.'}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {consumables.map(({ key, label, pct, buttonId, icon: Icon }) => {
                  const color = getConsumableColor(pct);
                  const radius = 36;
                  const circumference = 2 * Math.PI * radius;
                  const strokeDashoffset = circumference - (Math.min(100, Math.max(0, pct)) / 100) * circumference;
                  
                  return (
                    <div
                      key={key}
                      className="group relative flex flex-col items-center rounded-3xl border p-6 font-sans transition-all duration-300 bg-[var(--glass-bg)] border-[var(--glass-border)] hover:bg-[var(--glass-bg-hover)]"
                    >
                      {/* Circular Progress Ring */}
                      <div className="relative flex h-24 w-24 items-center justify-center">
                        <svg className="absolute inset-0 h-full w-full -rotate-90">
                          {/* Background Circle */}
                          <circle
                            cx="48"
                            cy="48"
                            r={radius}
                            className="stroke-[var(--glass-border)]"
                            strokeWidth="5"
                            fill="transparent"
                            style={{ stroke: 'rgba(255,255,255,0.05)' }}
                          />
                          {/* Foreground Circle */}
                          <circle
                            cx="48"
                            cy="48"
                            r={radius}
                            stroke={color}
                            strokeWidth="5"
                            fill="transparent"
                            strokeDasharray={circumference}
                            strokeDashoffset={strokeDashoffset}
                            strokeLinecap="round"
                            className="transition-all duration-1000 ease-out"
                            style={{ filter: `drop-shadow(0 0 4px ${color}44)` }}
                          />
                        </svg>
                        {/* Icon in Center */}
                        <div
                          className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-950/20"
                          style={{ color }}
                        >
                          <Icon className="h-6 w-6 stroke-[1.75]" />
                        </div>
                      </div>

                      {/* Label & Value */}
                      <h4 className="mt-4 text-sm font-semibold text-[var(--text-primary)]">{label}</h4>
                      <p className="mt-1 text-xs font-semibold" style={{ color }}>
                        {pct}% remaining
                      </p>

                      {/* Reset Actions */}
                      <div className="mt-5 flex w-full justify-center">
                        {confirmResetId === key ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleReset(buttonId, key)}
                              className="rounded-lg bg-red-500/20 hover:bg-red-500/35 px-3 py-1.5 text-xs font-bold text-red-400 transition-all border border-red-500/30"
                            >
                              {t('vacuum.reset') || 'Reset'}
                            </button>
                            <button
                              onClick={() => setConfirmResetId(null)}
                              className="rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] px-3 py-1.5 text-xs font-bold text-[var(--text-secondary)] transition-all hover:bg-[var(--glass-bg-hover)]"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            disabled={!buttonId}
                            onClick={() => setConfirmResetId(key)}
                            className={`flex items-center gap-1.5 rounded-xl border border-[var(--glass-border)] bg-white/5 px-4 py-1.5 text-xs font-bold tracking-wider uppercase transition-all duration-200 active:scale-95 ${
                              !buttonId
                                ? 'opacity-30 cursor-not-allowed'
                                : 'hover:bg-[var(--glass-bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                            }`}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            {t('vacuum.reset') || 'Reset'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {showTabbedLayout && activeTab === 'history' && (
            <div className="animate-in fade-in duration-300 max-w-xl mx-auto py-4">
              {renderHistoryCard()}
            </div>
          )}

          {/* Full Screen Live Map Zoom Modal Overlay */}
          {isMapZoomed && finalMapUrl && (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-2xl transition-all duration-300 bg-black/70 animate-in fade-in"
              onClick={() => setIsMapZoomed(false)}
            >
              <div
                className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/40 p-2 shadow-2xl backdrop-blur-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => setIsMapZoomed(false)}
                  className="absolute top-4 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white border border-white/10 hover:bg-black/80 transition-all hover:scale-105"
                  aria-label="Close Map Zoom"
                >
                  <Minimize2 className="h-5 w-5" />
                </button>
                <img
                  src={finalMapUrl}
                  alt="Live Zoomed Map"
                  className="max-h-[85vh] max-w-[85vw] object-contain rounded-2xl"
                />
              </div>
            </div>
          )}
        </>
      )}
    </AccessibleModalShell>
  );
}
