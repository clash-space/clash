const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS_PATTERN = /^(?:https?:|data:|file:)|[\\/]/i;

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const safeAssetName = (value: string | undefined) => {
  const name = value?.trim();
  if (!name || UUID_PATTERN.test(name) || ADDRESS_PATTERN.test(name)) {
    return undefined;
  }
  return name;
};

export const getTimelineItemDisplayLabel = ({
  type,
  text,
  assetName,
}: {
  type?: string;
  text?: string;
  assetName?: string;
}) => {
  if (type === 'text') {
    return text?.trim() || 'Text';
  }
  if (type === 'solid') {
    return 'Color';
  }
  return safeAssetName(assetName) || capitalize(type || 'media');
};
