// SPDX-License-Identifier: Apache-2.0
import { KeyedByBandId } from '../../components/KeyedByBandId';
import { BandSettings } from '../../pages/BandSettings';

export default function BandSettingsRoute() {
  return <KeyedByBandId Component={BandSettings} />;
}
