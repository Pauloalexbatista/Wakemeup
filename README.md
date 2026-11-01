# WakeMeUp! ("Before You Go-Go") ⏰🚌
Despertador inteligente baseado em localização e geofencing para transportes públicos.

## Como Funciona
1. **Escolhe a paragem**: Clica no mapa ou pesquisa uma morada/paragem.
2. **Define o raio de segurança**: 200m, 500m, 1km, 2km ou 3km.
3. **Ativa o Alarme**: O sistema ajusta a frequência do GPS dinamicamente (poupa bateria quando longe e afina a precisão quando perto).
4. **Acorda a tempo**: Ao entrar no raio, o telemóvel aciona alarme sonoro, vibração e ecrã de emergência!

## Como Publicar no VPS
Basta copiar estes ficheiros estáticos para qualquer pasta servida por Nginx, Caddy ou Apache (com HTTPS ativo para permitir a API de Geolocalização).

```bash
# Teste local rápido com Python:
python -m http.server 8080
```

## Como a tua irmã instala no telemóvel
1. Abre o link no **Chrome** (Android) ou **Safari** (iPhone).
2. Carrega nas opções e escolhe: **"Adicionar ao ecrã principal"** / **"Instalar App"**.
3. A app fica instalada com o ícone próprio, abre em ecrã inteiro e funciona como uma aplicação nativa!
