// SPDX-License-Identifier: Apache-2.0
import { KeyedByBandId } from '../../components/KeyedByBandId';
import { StageMode } from '../../pages/StageMode';

export default function StageModeRoute() {
  return <KeyedByBandId Component={StageMode} />;
}
