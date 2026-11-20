import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { LANGUAGES, fmtDate } from '../i18n';

type Opt = { value: string; label: string };
interface Field { key: string; type: 'text' | 'number' | 'date' | 'select' | 'lang'; required?: boolean; options?: string[]; optionsFrom?: string; labelKey?: string; optionLabel?: string; readonlyOnEdit?: boolean }
interface Col { key: string; label?: string; kind?: 'date' | 'enum' | 'secret' }

function Master({ endpoint, titleKey, fields, cols, defaults }: { endpoint: string; titleKey: string; fields: Field[]; cols: Col[]; defaults?: Record<string, any> }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<any[]>([]);
  const [lookups, setLookups] = useState<Record<string, Opt[]>>({});
  const [editing, setEditing] = useState<any | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const load = () => api(`/api/${endpoint}`).then(setRows).finally(() => setLoading(false));
  useEffect(() => {
    load();
    fields.filter((f) => f.optionsFrom).forEach(async (f) => {
      const data = await api(`/api/${f.optionsFrom}`);
      setLookups((l) => ({ ...l, [f.key]: data.map((d: any) => ({ value: d.id, label: d[f.optionLabel!] })) }));
    });
  }, [endpoint]); // eslint-disable-line

  const open = (row?: any) => { setErr(''); setEditing(row ? { ...row } : { ...defaults }); };
  async function save(e: FormEvent) {
    e.preventDefault(); setErr('');
    const body: any = {};
    for (const f of fields) {
      let v = editing[f.key];
      if (v === '' || v === undefined) v = null;
      if (f.type === 'number' && v !== null) v = Number(v);
      if (f.type === 'date' && typeof v === 'string') v = v.slice(0, 10);
      body[f.key] = v;
    }
    try {
      await api(editing.id ? `/api/${endpoint}/${editing.id}` : `/api/${endpoint}`, { method: editing.id ? 'PUT' : 'POST', body });
      setEditing(null); load();
    } catch (e: any) {
      setErr(e.body?.issues ? e.body.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; ') : e.body?.error === 'duplicate' ? 'Already exists' : (e.body?.error ?? 'Error'));
    }
  }
  async function del(row: any) {
    if (!confirm(t('c.confirmDelete'))) return;
    try { await api(`/api/${endpoint}/${row.id}`, { method: 'DELETE' }); load(); } catch (e: any) { alert(e.body?.error ?? 'Error'); }
  }
  const cell = (r: any, c: Col) => {
    const v = r[c.key];
    if (v == null || v === '') return <span className="muted">—</span>;
    if (c.kind === 'date') return fmtDate(v);
    if (c.kind === 'enum') return String(t(`e.${v}`, { defaultValue: String(v) }));
    if (c.kind === 'secret') return <code title={v}>{String(v).slice(0, 6)}…</code>;
    return String(v);
  };

  return (
    <div className="page">
      <div className="page-head"><h2>{t(titleKey)}</h2><button className="primary" onClick={() => open()}>+ {t('c.add')}</button></div>
      <div className="tablewrap">
        <table>
          <thead><tr>{cols.map((c) => <th key={c.key}>{t(`f.${c.label ?? c.key}`)}</th>)}<th>{t('c.actions')}</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={cols.length + 1} className="muted pad">{t('c.loading')}</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={cols.length + 1} className="muted pad">{t('c.empty')}</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                {cols.map((c) => <td key={c.key}>{cell(r, c)}</td>)}
                <td className="actions"><button className="link" onClick={() => open(r)}>{t('c.edit')}</button><button className="link danger" onClick={() => del(r)}>{t('c.delete')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="modal" onClick={() => setEditing(null)}>
          <form className="card" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <h3>{editing.id ? t('c.edit') : t('c.add')} — {t(titleKey)}</h3>
            {fields.map((f) => (
              <label key={f.key}>{t(`f.${f.labelKey ?? f.key}`)}{f.required && ' *'}
                {f.type === 'select' || f.type === 'lang' ? (
                  <select required={f.required} value={editing[f.key] ?? ''} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })}>
                    {!f.required && f.type === 'select' && <option value="">{t('c.none')}</option>}
                    {f.type === 'lang' && LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                    {f.options?.map((o) => <option key={o} value={o}>{String(t(`e.${o}`, { defaultValue: o }))}</option>)}
                    {lookups[f.key]?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input type={f.type} required={f.required} value={editing[f.key] ?? ''} disabled={f.readonlyOnEdit && !!editing.id}
                    onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })} />
                )}
              </label>
            ))}
            {err && <div className="error">{err}</div>}
            <div className="row end"><button type="button" onClick={() => setEditing(null)}>{t('c.cancel')}</button><button className="primary">{t('c.save')}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}

export const Vehicles = () => (
  <Master endpoint="vehicles" titleKey="nav.vehicles" defaults={{ type: 'truck', fuel_type: 'diesel', status: 'active' }}
    cols={[{ key: 'reg_number' }, { key: 'name' }, { key: 'type', kind: 'enum' }, { key: 'driver_name', label: 'driver' }, { key: 'device_imei', label: 'imei' }, { key: 'status', kind: 'enum' }]}
    fields={[
      { key: 'reg_number', type: 'text', required: true }, { key: 'name', type: 'text' },
      { key: 'type', type: 'select', required: true, options: ['car', 'truck', 'bus', 'van', 'bike', 'tractor', 'other'] },
      { key: 'make', type: 'text' }, { key: 'model', type: 'text' }, { key: 'year', type: 'number' },
      { key: 'fuel_type', type: 'select', required: true, options: ['diesel', 'petrol', 'cng', 'electric', 'hybrid', 'other'] },
      { key: 'driver_id', labelKey: 'driver', type: 'select', optionsFrom: 'drivers', optionLabel: 'name' },
      { key: 'status', type: 'select', required: true, options: ['active', 'inactive', 'maintenance'] },
    ]} />
);
export const Drivers = () => (
  <Master endpoint="drivers" titleKey="nav.drivers" defaults={{ preferred_language: 'en', status: 'active' }}
    cols={[{ key: 'name' }, { key: 'phone' }, { key: 'license_number' }, { key: 'license_expiry' }, { key: 'preferred_language' }, { key: 'status', kind: 'enum' }]}
    fields={[
      { key: 'name', type: 'text', required: true }, { key: 'phone', type: 'text' }, { key: 'license_number', type: 'text' },
      { key: 'license_expiry', type: 'date' }, { key: 'preferred_language', type: 'lang', required: true },
      { key: 'status', type: 'select', required: true, options: ['active', 'inactive'] },
    ]} />
);
export const Devices = () => (
  <Master endpoint="devices" titleKey="nav.devices"
    cols={[{ key: 'imei' }, { key: 'model' }, { key: 'sim_number' }, { key: 'vehicle_reg', label: 'vehicle' }, { key: 'api_key', kind: 'secret' }, { key: 'last_seen', kind: 'date' }]}
    fields={[
      { key: 'imei', type: 'text', required: true }, { key: 'model', type: 'text' }, { key: 'sim_number', type: 'text' },
      { key: 'vehicle_id', labelKey: 'vehicle', type: 'select', optionsFrom: 'vehicles', optionLabel: 'reg_number' },
    ]} />
);
