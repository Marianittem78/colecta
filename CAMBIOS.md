# Cambios de Colecta

## 1.0.5 — 24 de octubre de 2026

### Novedades

- **Threads tiene su tecla en Importar**, junto a Instagram, Facebook y YouTube, con la cantidad de enlaces que guardaste. Al tocarla explica cómo se guarda: de a una publicación, con Compartir → Más → Colecta.
- En el teléfono, las cuatro teclas de redes van de a dos, para que se lean bien el nombre y la cantidad de enlaces.
- Threads figura en la política de privacidad, en «Qué es Colecta» y en la descripción de la app. La política explica que, al compartir desde Threads, el servidor de Colecta abre el enlace en Threads, sin tu cuenta ni tus datos.

### Correcciones

- **Compartir desde Threads ya funciona.** Colecta abría Importar y no seguía, porque la app de Threads no manda la dirección de la publicación sino un enlace corto (`threads.com/share/…`). Ahora Colecta lo abre y guarda la publicación con su dirección completa, el autor y el texto, así el título se escribe solo, como en las demás redes.
- Si Colecta no reconoce lo que compartiste, el aviso muestra lo que recibió, para saber qué mandó la otra app. Y si algo falla al guardar lo compartido, ahora lo avisa en lugar de quedarse quieta.

### App de Android

- No hace falta actualizarla: todo funciona con la versión 1.0.3 que ya tenés.

## 1.0.4 — 24 de octubre de 2026

### Novedades

- **Compartí desde Threads.** En la app de Threads tocá Compartir → Más → **Colecta**: elegís en qué colección guardar la publicación y Colecta te devuelve a Threads, igual que con Instagram, Facebook y YouTube.
- **Los 40 íconos de colecciones, todos nuevos.** Se sumaron Unity, NSFW, Vinos, Salud, Webs Útiles, n8n, Training, Tips Cocina, Pelis | Series y Lifestyle, y los 30 anteriores se rehicieron con el mismo tamaño. Ahora pesan seis veces menos, así que la pantalla de colecciones carga más rápido.
- **Cada colección se ve con su nombre bien escrito**, el mismo que dice su ícono: «Webs Útiles» en lugar de «webs-tiles», «Criptos | Trading» en lugar de «Criptos-Trading», «Ver Más Tarde» en lugar de «VerMasTarde». Vale para los mosaicos, el título de la colección, las listas para elegir colección al importar o compartir, los avisos y lo que exportás. Las colecciones sin ícono que llegan escritas como dirección también se arreglan: «mis-recetas» se ve como «Mis recetas».
- El ícono aparece aunque la colección tenga las palabras en otro orden («plantas-tips» → Tips Plantas) o le falte la letra con tilde que pierden las exportaciones («pel-culas», «webs-tiles»).

### Correcciones

- Si importás una colección que se llama distinto pero se ve igual que una que ya tenés (por ejemplo «webs-tiles» y «Webs Útiles»), los enlaces van a la misma colección en lugar de abrir otra.

### App de Android

- No hace falta actualizarla: compartir desde Threads funciona con la versión 1.0.3 que ya tenés.

## 1.0.3 — 11 de octubre de 2026

### Novedades

- **Entrá con Google.** En la pantalla de ingreso está «Continuar con Google». Si ya tenías cuenta con ese mismo email, entrás a tu misma cuenta, con todas tus colecciones.
- **«¿Olvidaste tu contraseña?»** Te llega un correo con un enlace; al abrirlo entrás a Colecta y elegís una contraseña nueva.
- **Ícono nuevo de tres anillos**, el mismo logo que ya se veía dentro de la app, ahora también en el teléfono y en la pestaña del navegador.
- Páginas **Qué es Colecta**, **Política de privacidad** y **Condiciones de uso**, enlazadas al pie de la pantalla de ingreso.

### Correcciones

- **Registrarse con un email que ya tiene cuenta** ahora lo dice y te lleva a «Ingresar». Antes decía «te enviamos un email de confirmación», pero ese correo nunca salía, porque la cuenta ya estaba confirmada.
- Si abrís un enlace de confirmación o de recuperación vencido, la app avisa que pidas uno nuevo.
- Al compartir a Colecta con una colección ya elegida, ya no aparece de más el campo «Nombre de la nueva colección».

### App de Android

- **Versión 1.0.3**, con el ícono nuevo. Se descarga desde <https://marianittem78.github.io/descargar.html> y se instala sobre la versión anterior sin perder nada. Los demás cambios llegan solos, aunque no la actualices.

## 1.0.2 — 11 de octubre de 2026

### Novedades

- **Compartir desde Android, de punta a punta.** Al compartir una publicación de Instagram, Facebook o YouTube a Colecta, la app pregunta en qué colección guardarla (o te deja crear una nueva). Recuerda la última que elegiste para cada red y avisa si ese enlace ya estaba guardado. Al terminar muestra «¡Listo!» y te devuelve a la app de la que venías. Si la conexión falla, ofrece reintentar sin perder el enlace.
- **Títulos que se entienden de un vistazo.** Cada enlace muestra un título corto en español que dice de qué trata, en lugar del texto de gancho del autor. Los enlaces que se importan a partir de ahora se titulan solos con Claude, que distingue las partes de una serie (por ejemplo, la fecha de cada edición) y nombra lugares, libros y herramientas.
- **Íconos nuevos** para las colecciones Coding, Comfy, Criptos-Trading, Desarrollo personal, Dibujo, Dropshipping y Foto tips.
- La tarjeta «Compartir a Colecta desde el teléfono» ahora tiene el enlace para descargar la app de Android.

### Correcciones

- **Ya no desaparecen colecciones.** Después de usar «Enriquecer ahora» o de importar, podían faltar colecciones enteras: la carga de enlaces se hacía por páginas con un orden ambiguo y perdía o repetía cientos de enlaces guardados en el mismo instante. Ahora el orden no deja dudas y se comprueba que lleguen todos. Si no llegan, la app lo dice y ofrece «Reintentar» en lugar de mostrar una lista incompleta.
- Mientras se cargan tus enlaces no se importa ni se modifica nada. Lo que llega en ese momento (desde el marcador o al compartir) queda en espera y se guarda apenas termina la carga.
- En la app de Android, compartir a Colecta ahora envía el enlace; antes solo abría la app.

### App de Android

- **Versión 1.0.2.** Se descarga desde <https://marianittem78.github.io/descargar.html> y se instala sobre la versión anterior sin perder nada.

## 1.0.1 y anteriores

Ver el historial de commits del repositorio.
