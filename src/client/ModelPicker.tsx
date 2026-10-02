import { useEffect, useId, useRef, useState } from 'react';
import { Button, IconCheckOutlineRegular, IconChevronRightOutlineRegular, Input, MenuGroup, rankByName } from '@deepseek-ai/dsh-client-ui-primitives';
import type { Choice } from './preferences.ts';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';

export function ModelPicker({ label, value, choices, disabled, onOpen, t }: {
  label: string; value: string; choices: Choice[]; disabled?: boolean; onOpen: () => void;
} & PropsLocale<'agentRouter'>) {
  const selected = choices.find(choice => choice.value === value);
  return <div className="dar-picker"><span>{label}</span>
    <Button variant="outline" size="sm" className="dar-picker-trigger" aria-label={label} disabled={disabled}
      title={selected ? `${selected.providerName ?? selected.provider} / ${selected.name}` : undefined} onClick={onOpen}>
      <span>{selected?.name ?? t('chooseModel')}</span><IconChevronRightOutlineRegular size={12} />
    </Button>
  </div>;
}

/** Provider-grouped menu using the composer's native model-name search. */
export function ModelList({ label, value, choices, disabled, onChange, t }: {
  label: string; value: string; choices: Choice[]; disabled?: boolean; onChange: (value: string) => void;
} & PropsLocale<'agentRouter'>) {
  const [query, setQuery] = useState(''), [active, setActive] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null), listRef = useRef<HTMLDivElement>(null);
  const id = useId(), searchable = choices.length > 4;
  const providers = [...new Set(choices.map(choice => choice.provider))];
  const groups = providers.map(provider => ({ provider,
    name: choices.find(choice => choice.provider === provider)!.providerName ?? provider,
    choices: rankByName(choices.filter(choice => choice.provider === provider), query.trim()),
  })).filter(group => group.choices.length);
  const rows = groups.flatMap(group => group.choices);
  const selectedIndex = rows.findIndex(choice => choice.value === value);
  const highlighted = Math.min(active ?? Math.max(0, selectedIndex), rows.length - 1);
  useEffect(() => {
    if (searchable) searchRef.current?.focus({ preventScroll: true });
    else (listRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? listRef.current?.querySelector<HTMLButtonElement>('button'))?.focus({ preventScroll: true });
  }, [searchable]);
  function move(step: number) {
    if (!rows.length) return;
    const next = (highlighted + step + rows.length) % rows.length;
    setActive(next);
    const button = listRef.current?.querySelector<HTMLButtonElement>(`[data-choice-index="${next}"]`);
    button?.scrollIntoView({ block: 'nearest' });
    if (!searchable) button?.focus({ preventScroll: true });
  }
  let index = 0;
  return <div className="dar-model-list" onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); move(event.key === 'ArrowDown' ? 1 : -1); }
    else if (event.key === 'Enter' && event.target === searchRef.current && rows[highlighted] && !disabled) {
      event.preventDefault(); onChange(rows[highlighted].value);
    }
  }}>
    {searchable && <Input ref={searchRef} className="dar-model-search" role="searchbox" aria-label={t('searchModels')} placeholder={t('searchModels')}
      aria-controls={id} aria-activedescendant={highlighted >= 0 ? `${id}-${highlighted}` : undefined}
      value={query} disabled={disabled} onChange={event => { setQuery(event.target.value); setActive(0); }} />}
    <div id={id} ref={listRef} role="menu" aria-label={label} className="dar-model-groups scrollable">
      {groups.map(group => <MenuGroup key={group.provider} label={group.name}>
        {group.choices.map(choice => { const row = index++; return <button key={choice.value} type="button" role="menuitemradio"
          id={`${id}-${row}`} aria-checked={choice.value === value} data-choice-index={row} data-highlighted={row === highlighted} disabled={disabled}
          tabIndex={searchable ? -1 : 0} className="dar-model-option" title={choice.name}
          onMouseMove={() => setActive(row)} onFocus={() => setActive(row)} onClick={() => onChange(choice.value)}>
          <span>{choice.name}</span><span className="dar-model-check">{choice.value === value && <IconCheckOutlineRegular size={14} />}</span>
        </button>; })}
      </MenuGroup>)}
      {!rows.length && <div className="dar-form-note" role="status">{t(query ? 'noMatchingModels' : 'noModels')}</div>}
    </div>
  </div>;
}
