import type { SmartModelFormat } from '@/application';

import type { ContactProbabilityModel } from './contact-match-matrix';
import { createLinearContactProbabilityModel } from './linear-contact-probability-model';
import { createTreeEnsembleContactProbabilityModel } from './tree-ensemble-contact-probability-model';

type ModelFactory = (bytes: Uint8Array) => ContactProbabilityModel;

const factories: Readonly<Record<SmartModelFormat, ModelFactory>> = Object.freeze({
  'contactifier-linear-v1': createLinearContactProbabilityModel,
  'contactifier-tree-ensemble-v1': createTreeEnsembleContactProbabilityModel,
});

export function createContactProbabilityModel(
  format: SmartModelFormat,
  bytes: Uint8Array,
): ContactProbabilityModel {
  return factories[format](bytes);
}
