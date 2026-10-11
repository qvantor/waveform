import React from 'react';
import styled from 'styled-components';
import { Button, Input, Modal, Tooltip, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Turnstile, TurnstileInstance } from '@marsidev/react-turnstile';
import toast from 'react-hot-toast';
import {
  nameKey,
  PRESET_NAME_MAX_LENGTH,
  presetNameSchema,
  UpdatePresetRequest,
} from '@waveform/preset-schema';
import { getSnapshot } from '../../app';
import { usePresets } from '../modules/presets';
import { useDebounced } from '../hooks/use-debounced';
import {
  ApiRequestError,
  getEditToken,
  isNameAvailable,
  presetUrl,
  savePreset,
  setEditToken,
  sharePreset,
  updatePreset,
} from '../services';

const NAME_CHECK_DEBOUNCE_MS = 300;

const TURNSTILE_SITE_KEY = process.env['NX_TURNSTILE_SITE_KEY'] ?? '';

// https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/
const captchaErrorMessage = (code: string) => {
  if (code.startsWith('110200'))
    return `Captcha is not allowed on ${window.location.hostname}, add it to the widget hostnames in Cloudflare.`;
  if (code.startsWith('1101') || code.startsWith('400020'))
    return 'Captcha site key is invalid, check NX_TURNSTILE_SITE_KEY.';
  return `Captcha check failed (error ${code}).`;
};

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Link = styled.div`
  display: flex;
  gap: 8px;
`;

interface SavedResult {
  id: string;
  message: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export const SaveDialog = ({ open, onClose }: Props) => {
  const [{ $current }, { setSaved }] = usePresets();
  const [name, setName] = React.useState('');
  const [token, setToken] = React.useState<string | null>(null);
  const [captchaError, setCaptchaError] = React.useState<string | null>(null);
  const [saved, setSavedResult] = React.useState<SavedResult | null>(null);
  // the current preset was created from this browser, so it can be overwritten
  const [editable, setEditable] = React.useState<{ id: string; name: string; editToken: string } | null>(
    null
  );
  const turnstile = React.useRef<TurnstileInstance>();
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (!open) return;
    const current = $current.value;
    const editToken = current && getEditToken(current.id);
    setName(current?.name ?? '');
    setSavedResult(null);
    setCaptchaError(null);
    setEditable(current && editToken ? { ...current, editToken } : null);
  }, [open, $current]);

  // names are unique, check while typing so the captcha isn't spent on a taken name
  const validName = presetNameSchema.safeParse(name).success;
  const key = nameKey(name);
  const debouncedKey = useDebounced(key, NAME_CHECK_DEBOUNCE_MS);
  const isOwnName = editable !== null && key === nameKey(editable.name);
  const nameCheck = useQuery({
    queryKey: ['presets', 'name-available', debouncedKey],
    queryFn: () => isNameAvailable(debouncedKey),
    enabled: open && !saved && validName && !isOwnName && debouncedKey === key,
    staleTime: 10 * 1000,
  });
  const nameTaken = !isOwnName && debouncedKey === key && nameCheck.data?.available === false;

  const onSaveError = (e: unknown) => {
    toast.error(e instanceof Error ? e.message : 'Saving failed');
    if (e instanceof ApiRequestError && e.status === 409)
      queryClient.invalidateQueries({ queryKey: ['presets', 'name-available'] });
  };

  const { mutate, isLoading } = useMutation({
    mutationFn: savePreset,
    onSuccess: (result) => {
      if (result.editToken) setEditToken(result.id, result.editToken);
      setSavedResult({
        id: result.id,
        message: result.existed
          ? `This sound is already saved as “${result.name}”.`
          : `“${result.name}” has been saved.`,
      });
      setSaved({ id: result.id, name: result.name });
    },
    onError: onSaveError,
    // the token is single use
    onSettled: () => {
      setToken(null);
      setCaptchaError(null);
      turnstile.current?.reset();
    },
  });

  const overwriteMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePresetRequest }) => updatePreset(id, body),
    onSuccess: (result) => {
      setSavedResult({ id: result.id, message: `“${result.name}” has been updated.` });
      setSaved(result);
    },
    onError: onSaveError,
  });

  const busy = isLoading || overwriteMutation.isLoading;
  const canSave = validName && !nameTaken && !isOwnName && token !== null;
  const canOverwrite = validName && !nameTaken && editable !== null;
  const secondaryType = editable ? 'default' : 'primary';
  const save = () => {
    if (!canSave || busy) return;
    mutate({ name, data: getSnapshot(), turnstileToken: token });
  };
  const overwrite = () => {
    if (!canOverwrite || busy) return;
    overwriteMutation.mutate({
      id: editable.id,
      body: { name, data: getSnapshot(), editToken: editable.editToken },
    });
  };

  return (
    <Modal
      title='Save preset'
      open={open}
      onCancel={onClose}
      destroyOnClose
      footer={
        saved ? (
          <Button type='primary' onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            {captchaError ? (
              <Button
                type={secondaryType}
                onClick={() => {
                  setCaptchaError(null);
                  turnstile.current?.reset();
                }}
              >
                Retry
              </Button>
            ) : (
              <Tooltip title={isOwnName ? 'Choose a new name' : undefined}>
                <Button
                  type={secondaryType}
                  onClick={save}
                  disabled={!canSave || overwriteMutation.isLoading}
                  loading={isLoading}
                >
                  {token ? (editable ? 'Save as new' : 'Save') : 'Checking...'}
                </Button>
              </Tooltip>
            )}
            {editable && (
              <Button
                type='primary'
                onClick={overwrite}
                disabled={!canOverwrite || isLoading}
                loading={overwriteMutation.isLoading}
              >
                Save
              </Button>
            )}
          </>
        )
      }
    >
      {saved ? (
        <Content>
          <Typography.Text>{saved.message}</Typography.Text>
          <Link>
            <Input value={presetUrl(saved.id)} readOnly />
            <Button onClick={() => sharePreset(saved.id)}>Copy link</Button>
          </Link>
        </Content>
      ) : (
        <Content>
          <Typography.Text type='secondary'>
            {editable
              ? `Save overwrites “${editable.name}”, its links will play the updated sound. Save as new keeps it unchanged.`
              : 'A new preset will be created. You can overwrite it later from this browser.'}
          </Typography.Text>
          <Input
            autoFocus
            placeholder='Preset name'
            maxLength={PRESET_NAME_MAX_LENGTH}
            showCount
            value={name}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={editable ? overwrite : save}
            status={nameTaken ? 'error' : undefined}
          />
          {nameTaken && <Typography.Text type='danger'>Name is already taken</Typography.Text>}
          <Turnstile
            ref={turnstile}
            siteKey={TURNSTILE_SITE_KEY}
            // shown only when the visitor has to interact (managed widget), invisible widgets never show up
            options={{ appearance: 'interaction-only' }}
            onSuccess={(value) => {
              setCaptchaError(null);
              setToken(value);
            }}
            onExpire={() => setToken(null)}
            onError={(code) => {
              setToken(null);
              setCaptchaError(captchaErrorMessage(String(code)));
            }}
            onUnsupported={() => setCaptchaError('Captcha is not supported by this browser.')}
          />
          {captchaError && <Typography.Text type='danger'>{captchaError}</Typography.Text>}
        </Content>
      )}
    </Modal>
  );
};
