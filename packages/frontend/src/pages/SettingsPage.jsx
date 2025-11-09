import React, { useEffect, useState } from 'react';

export default function SettingsPage({ settings, onSave, saving }) {
  const [formState, setFormState] = useState(settings || {});

  useEffect(() => {
    setFormState(settings || {});
  }, [settings]);

  const updateField = (field, value) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    await onSave(formState);
  };

  return (
    <div className="page">
      <div className="tab-view single">
        <div className="tab-toolbar">
          <button className="primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        <div className="tab-content">
          <div className="panel settings-grid">
            <label>
              Theme
              <select value={formState.theme || 'light'} onChange={(event) => updateField('theme', event.target.value)}>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label>
              Workspace
              <input value={formState.workspace || ''} onChange={(event) => updateField('workspace', event.target.value)} />
            </label>
            <label>
              Agent endpoint
              <input value={formState.agentEndpoint || ''} onChange={(event) => updateField('agentEndpoint', event.target.value)} />
            </label>
            <label>
              Agent API key
              <input value={formState.agentApiKey || ''} onChange={(event) => updateField('agentApiKey', event.target.value)} />
            </label>
            <label>
              Notifications
              <select value={formState.notifications ? 'yes' : 'no'} onChange={(event) => updateField('notifications', event.target.value === 'yes')}>
                <option value="yes">Enabled</option>
                <option value="no">Disabled</option>
              </select>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
