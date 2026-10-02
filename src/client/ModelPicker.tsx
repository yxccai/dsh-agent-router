import type { Choice } from './preferences.ts';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';

export function ModelPicker({ label, value, choices, disabled, onChange, t }: {
  label: string; value: string; choices: Choice[]; disabled?: boolean; onChange: (value: string) => void;
} & PropsLocale<'agentRouter'>) {
  const providers = [...new Set(choices.map(choice => choice.provider))];
  return <label className="dar-picker"><span>{label}</span>
    <select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
      <option value="" disabled>{t('chooseModel')}</option>
      {providers.map(provider => <optgroup key={provider} label={provider}>
        {choices.filter(choice => choice.provider === provider).map(choice => <option key={choice.value} value={choice.value}>{choice.name}</option>)}
      </optgroup>)}
    </select>
  </label>;
}
