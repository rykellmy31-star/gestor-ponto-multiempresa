
import { useEffect, useState } from 'react';
import { HeartHandshake } from 'lucide-react';
import { api } from './api';
import {
  Button,
  InlineError,
  Modal,
  Spinner,
  useToast
} from './ui';

type Mood =
  | 'very_happy'
  | 'good'
  | 'neutral'
  | 'sad'
  | 'stressed';

const moods: {
  value: Mood;
  emoji: string;
  label: string;
}[] = [
  { value: 'very_happy', emoji: '😄', label: 'Muito feliz' },
  { value: 'good', emoji: '🙂', label: 'Bem' },
  { value: 'neutral', emoji: '😐', label: 'Normal' },
  { value: 'sad', emoji: '😔', label: 'Triste' },
  { value: 'stressed', emoji: '😣', label: 'Estressado' }
];

export function MoodDialog({
  onClose
}: {
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Mood | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();

  useEffect(() => {
    let active = true;

    api<{
      eligible: boolean;
      answered: boolean;
    }>('/employee/mood/today')
      .then(result => {
        if (!active) return;

        if (!result.eligible || result.answered) {
          onClose();
          return;
        }

        setChecking(false);
      })
      .catch(() => {
        if (active) onClose();
      });

    return () => {
      active = false;
    };
  }, []);

  async function sendMood() {
    if (!selected || busy) return;

    setBusy(true);
    setError(null);

    try {
      await api('/employee/mood', 'POST', {
        mood: selected
      });

      toast('Obrigado por compartilhar como você está!');
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Como está seu humor hoje?"
      description="Seu ponto já foi registrado. Quer compartilhar como está se sentindo?"
      onClose={onClose}
    >
      {checking ? (
        <Spinner label="Preparando sua pergunta..." />
      ) : (
        <div style={{
          display: 'grid',
          gap: 20,
          paddingTop: 8
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            color: '#8b101c'
          }}>
            <HeartHandshake size={38} strokeWidth={1.5} />
          </div>

          <p style={{
            textAlign: 'center',
            color: '#64748b',
            margin: 0,
            fontSize: 14,
            lineHeight: 1.6
          }}>
            Escolha o emoji que melhor representa
            como você está se sentindo.
          </p>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            gap: 7
          }}>
            {moods.map(item => {
              const active = selected === item.value;

              return (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={active}
                  aria-label={item.label}
                  disabled={busy}
                  onClick={() => setSelected(item.value)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    minWidth: 0,
                    minHeight: 100,
                    padding: '12px 4px',
                    borderRadius: 13,
                    cursor: 'pointer',
                    border: active
                      ? '2px solid #900014'
                      : '1px solid #e2e8f0',
                    background: active
                      ? '#fff1f2'
                      : '#ffffff',
                    boxShadow: active
                      ? '0 3px 12px rgba(144,0,20,0.12)'
                      : 'none'
                  }}
                >
                  <span style={{
                    fontSize: 31,
                    lineHeight: 1.2
                  }}>
                    {item.emoji}
                  </span>

                  <span style={{
                    fontSize: 11,
                    fontWeight: active ? 700 : 500,
                    color: active ? '#900014' : '#475569',
                    textAlign: 'center',
                    overflowWrap: 'anywhere'
                  }}>
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>

          <p style={{
            margin: 0,
            fontSize: 12,
            color: '#64748b',
            lineHeight: 1.6,
            textAlign: 'center'
          }}>
            Sua participação é voluntária.
            O administrador poderá acompanhar
            sua resposta no relatório da equipe.
            A resposta não interfere no seu ponto.
          </p>

          <InlineError error={error} />

          <div className="modal-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={onClose}
            >
              Pular
            </Button>

            <Button
              type="button"
              disabled={!selected || busy}
              busy={busy}
              onClick={sendMood}
            >
              Enviar resposta
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
