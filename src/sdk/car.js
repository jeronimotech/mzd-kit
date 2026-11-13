// Vehicle data: friendly names → CMU data ids (as exposed by the CASDK host).
// Values arrive already scaled to human units (km/h, rpm, °C, %…).
import { createEmitter } from './emitter.js';

export const SIGNALS = {
  speed: { id: 'VDTVehicleSpeed', unit: 'km/h' },
  rpm: { id: 'VDTEngineSpeed', unit: 'rpm' },
  fuel: { id: 'VDTFuelGaugePosition', unit: '%' },
  avgConsumption: { id: 'VDTDrv1AvlFuelE', unit: 'L/100km' },
  odometer: { id: 'VDTCOdocount', unit: 'km' },
  battery: { id: 'VDTCBattery_StateOfCharge', unit: '' },
  outsideTemp: { id: 'VDTOut-CarTemperature', unit: '°C' },
  intakeTemp: { id: 'VDTDR_IntakeAirTemp', unit: '°C' },
  coolantTemp: { id: 'VDTEngClnt_Te_Actl', unit: '°C' },
  latitude: { id: 'GPSLatitude', unit: '°' },
  longitude: { id: 'GPSLongitude', unit: '°' },
  altitude: { id: 'GPSAltitude', unit: 'm' },
  heading: { id: 'GPSHeading', unit: '°' },
  gpsSpeed: { id: 'GPSVelocity', unit: 'km/h' },
};

const GPS_KEYS = ['latitude', 'longitude', 'altitude', 'heading', 'gpsSpeed'];

/**
 * @param {(dataId: string, cb: (value: any) => void) => void} subscribe  host subscription
 */
export function createCar(subscribe) {
  const values = {};
  const events = createEmitter();
  const subscribed = {};

  function ensure(key) {
    if (subscribed[key]) return;
    const sig = SIGNALS[key];
    if (!sig) throw new Error('[mzd-kit] unknown car signal "' + key + '". Known: ' + Object.keys(SIGNALS).join(', ') + ', gps');
    subscribed[key] = true;
    subscribe(sig.id, (raw) => {
      const v = raw === '' || raw === null || raw === undefined ? null : Number(raw);
      const value = isNaN(v) ? raw : v;
      if (values[key] === value) return;
      values[key] = value;
      events.emit(key, value);
      if (GPS_KEYS.includes(key)) events.emit('gps', gps());
    });
  }

  function gps() {
    return {
      lat: values.latitude == null ? null : values.latitude,
      lon: values.longitude == null ? null : values.longitude,
      altitude: values.altitude == null ? null : values.altitude,
      heading: values.heading == null ? null : values.heading,
      speed: values.gpsSpeed == null ? null : values.gpsSpeed,
    };
  }

  return {
    /** Subscribe to a signal (`speed`, `rpm`, …, or `gps`). Returns an unsubscribe fn. */
    on(key, fn) {
      if (key === 'gps') GPS_KEYS.forEach(ensure);
      else ensure(key);
      const off = events.on(key, fn);
      const current = key === 'gps' ? gps() : values[key];
      if (current != null && (key !== 'gps' || current.lat != null)) fn(current);
      return off;
    },
    /** Last known value (or null). */
    get(key) {
      if (key === 'gps') { GPS_KEYS.forEach(ensure); return gps(); }
      ensure(key);
      return values[key] == null ? null : values[key];
    },
    unit(key) {
      return SIGNALS[key] ? SIGNALS[key].unit : '';
    },
    signals: Object.keys(SIGNALS).concat(['gps']),
  };
}
