// Leitor de CSV em fluxo (separador ";", aspas duplas), para arquivos de vários gigabytes.
// Recebe pedaços de texto e entrega cada registro completo como array de campos.

export function criarLeitorCsv(aoLerRegistro, separador = ';') {
  let campo = '';
  let registro = [];
  let entreAspas = false;
  let aspaPendente = false;
  let primeiro = true;

  const fecharCampo = () => {
    registro.push(campo);
    campo = '';
  };
  const fecharRegistro = () => {
    fecharCampo();
    if (registro.length > 1 || registro[0] !== '') aoLerRegistro(registro);
    registro = [];
  };

  return {
    escrever(texto) {
      if (primeiro) {
        texto = texto.replace(/^﻿/, '');
        primeiro = false;
      }
      let inicio = 0;
      for (let i = 0; i < texto.length; i++) {
        const c = texto.charCodeAt(i);
        if (aspaPendente) {
          aspaPendente = false;
          if (c === 34) {
            campo += '"';
            inicio = i + 1;
            continue;
          }
          entreAspas = false;
        }
        if (entreAspas) {
          if (c === 34) {
            campo += texto.slice(inicio, i);
            aspaPendente = true;
            inicio = i + 1;
          }
          continue;
        }
        if (c === 34) {
          campo += texto.slice(inicio, i);
          entreAspas = true;
          inicio = i + 1;
        } else if (c === 59 && separador === ';') {
          campo += texto.slice(inicio, i);
          fecharCampo();
          inicio = i + 1;
        } else if (c === 10) {
          campo = (campo + texto.slice(inicio, i)).replace(/\r$/, '');
          fecharRegistro();
          inicio = i + 1;
        }
      }
      campo += texto.slice(inicio);
    },
    terminar() {
      if (aspaPendente) entreAspas = false;
      if (campo !== '' || registro.length) fecharRegistro();
    },
  };
}
