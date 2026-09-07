// SPDX-License-Identifier: Apache-2.0
import { KeyedByBandId } from '../../components/KeyedByBandId';
import { Repertoire } from '../../pages/Repertoire';

export default function RepertoireRoute() {
  return <KeyedByBandId Component={Repertoire} />;
}
